//! End-to-end handler tests over the in-memory fakes: hash-chain integrity,
//! idempotency (upload_id + event_id), device scoping, policy download, and
//! registration.

use app::testing::{
    batch_body, sample_event, FakeIdentityIssuer, FakeUserIdentity, InMemoryAdminRepo,
    InMemoryArchive, InMemoryAuditRepo, InMemoryAuditStore, InMemoryDevices, InMemoryIdempotency,
    InMemoryPolicies, InMemorySettings, InMemoryUsers, StaticEnrollment,
};
use app::{
    can_create_user, handle_admin_audit_chain, handle_admin_audit_detail, handle_admin_audit_list,
    handle_admin_audit_violation_list, handle_admin_device_delete, handle_admin_device_get,
    handle_admin_device_list, handle_admin_settings_get, handle_admin_settings_put,
    handle_admin_stats, handle_admin_user_create, handle_admin_user_delete, handle_admin_user_list,
    handle_events_batch, handle_health, handle_policy_latest, handle_register, AdminPageQuery,
    AdminSearchQuery, PolicyOutcome, RegisterRequest, RequestContext, SettingsUpdateRequest,
    UserCreateRequest, UserListQuery,
};
use audit_core::{verify_event_hash, AuditEvent, GENESIS_PREV};

fn ctx() -> RequestContext {
    RequestContext {
        device_id: "dev-1".to_string(),
        org_id: "org-1".to_string(),
    }
}

/// Walks a device chain asserting every link and hash is intact.
fn assert_chain_valid(events: &[AuditEvent]) {
    let mut prev = GENESIS_PREV.to_string();
    for e in events {
        assert_eq!(
            e.previous_event_hash.as_deref(),
            Some(prev.as_str()),
            "chain link"
        );
        assert!(
            verify_event_hash(e),
            "event_hash verifies for {}",
            e.event_id
        );
        prev = e.event_hash.clone().expect("event_hash set");
    }
}

#[tokio::test]
async fn batch_builds_a_valid_hash_chain() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();

    let events = vec![
        sample_event("dev-1", "e1", 100),
        sample_event("dev-1", "e2", 200),
        sample_event("dev-1", "e3", 300),
    ];
    let body = batch_body(&events);

    let resp = handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap();
    assert_eq!(resp.accepted, 3);
    assert_eq!(resp.rejected, 0);
    assert!(!resp.replayed);
    assert_eq!(archive.count(), 1);

    let chain = store.chain_for("dev-1");
    assert_eq!(chain.len(), 3);
    assert_eq!(chain[0].previous_event_hash.as_deref(), Some(GENESIS_PREV));
    assert_chain_valid(&chain);
}

#[tokio::test]
async fn replaying_same_upload_id_is_idempotent() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();
    let body = batch_body(&[
        sample_event("dev-1", "e1", 1),
        sample_event("dev-1", "e2", 2),
    ]);

    let first = handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap();
    assert!(!first.replayed);
    assert_eq!(first.accepted, 2);

    // Same batch again → derived upload_id matches → replayed, nothing re-stored.
    let second = handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap();
    assert!(second.replayed);
    assert_eq!(second.accepted, 2);
    assert_eq!(second.upload_id, first.upload_id);
    assert_eq!(store.stored_count(), 2, "no duplicate records");
}

#[tokio::test]
async fn explicit_upload_id_header_is_honored() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();
    let body = batch_body(&[sample_event("dev-1", "e1", 1)]);

    let a = handle_events_batch(&store, &archive, &idem, &ctx(), Some("upload-xyz"), &body)
        .await
        .unwrap();
    assert_eq!(a.upload_id, "upload-xyz");
    let b = handle_events_batch(&store, &archive, &idem, &ctx(), Some("upload-xyz"), &body)
        .await
        .unwrap();
    assert!(b.replayed);
}

#[tokio::test]
async fn overlapping_batches_dedup_on_event_id() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();

    let b1 = batch_body(&[
        sample_event("dev-1", "e1", 1),
        sample_event("dev-1", "e2", 2),
    ]);
    let b2 = batch_body(&[
        sample_event("dev-1", "e2", 2),
        sample_event("dev-1", "e3", 3),
    ]);

    handle_events_batch(&store, &archive, &idem, &ctx(), None, &b1)
        .await
        .unwrap();
    let r2 = handle_events_batch(&store, &archive, &idem, &ctx(), None, &b2)
        .await
        .unwrap();

    // e2 is a duplicate (accepted, not re-stored); e3 is new.
    assert_eq!(r2.accepted, 2);
    assert_eq!(store.stored_count(), 3);
    let chain = store.chain_for("dev-1");
    assert_eq!(chain.len(), 3);
    assert_chain_valid(&chain); // chain remains intact across overlapping batches
}

#[tokio::test]
async fn tampering_breaks_the_chain() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();
    let body = batch_body(&[
        sample_event("dev-1", "e1", 1),
        sample_event("dev-1", "e2", 2),
    ]);
    handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap();

    let mut chain = store.chain_for("dev-1");
    assert_chain_valid(&chain);
    // Mutate a stored event's content; its event_hash no longer verifies.
    chain[0].decision = pe_core::Action::Block;
    assert!(!verify_event_hash(&chain[0]), "tamper detected");
}

#[tokio::test]
async fn foreign_device_events_are_rejected() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();
    // ctx is dev-1, but the event claims dev-2.
    let body = batch_body(&[sample_event("dev-2", "e1", 1)]);
    let resp = handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap();
    assert_eq!(resp.accepted, 0);
    assert_eq!(resp.rejected, 1);
    assert_eq!(store.stored_count(), 0);
}

#[tokio::test]
async fn empty_batch_is_unprocessable() {
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();
    let body = batch_body(&[]);
    let err = handle_events_batch(&store, &archive, &idem, &ctx(), None, &body)
        .await
        .unwrap_err();
    assert_eq!(err.status(), 422);
}

#[tokio::test]
async fn policy_latest_returns_bundle_and_handles_etag() {
    let policies = InMemoryPolicies::default();
    policies.publish("org-1", 7, b"{\"version\":7}".to_vec());

    match handle_policy_latest(&policies, "org-1", None, None)
        .await
        .unwrap()
    {
        PolicyOutcome::Bundle { version, .. } => assert_eq!(version, 7),
        PolicyOutcome::NotModified => panic!("expected bundle"),
    }
    // Matching ETag → 304.
    assert!(matches!(
        handle_policy_latest(&policies, "org-1", Some("7"), None)
            .await
            .unwrap(),
        PolicyOutcome::NotModified
    ));
    // Unknown org → 404.
    assert_eq!(
        handle_policy_latest(&policies, "org-unknown", None, None)
            .await
            .unwrap_err()
            .status(),
        404
    );
}

#[tokio::test]
async fn register_validates_enrollment_and_issues_tokens() {
    let enrollment = StaticEnrollment::single("secret-token", "org-1");
    let devices = InMemoryDevices::default();
    let identity = FakeIdentityIssuer;

    let req = RegisterRequest {
        device_id: "dev-1".into(),
        hostname: "mac".into(),
        platform: "macos".into(),
        agent_version: "0.1.0".into(),
        model: Some("MacBookPro18,3".into()),
        os_version: Some("macOS 15.5".into()),
        username: Some("alice".into()),
        hostname_full: Some("mac.corp.example.com".into()),
    };
    let resp = handle_register(
        &enrollment,
        &devices,
        &identity,
        Some("secret-token"),
        req,
        1000,
    )
    .await
    .unwrap();
    assert_eq!(resp.org_id, "org-1");
    assert!(resp.access_token.contains("dev-1"));
    assert_eq!(devices.count(), 1);

    // Bad token → 401.
    let bad = RegisterRequest {
        device_id: "dev-2".into(),
        hostname: "m".into(),
        platform: "macos".into(),
        agent_version: "0".into(),
        model: None,
        os_version: None,
        username: None,
        hostname_full: None,
    };
    let err = handle_register(&enrollment, &devices, &identity, Some("wrong"), bad, 1000)
        .await
        .unwrap_err();
    assert_eq!(err.status(), 401);
}

#[test]
fn health_is_healthy() {
    let h = handle_health("0.1.0", "2026-06-05T00:00:00Z");
    assert_eq!(h.status, "healthy");
    assert_eq!(h.version, "0.1.0");
}

#[tokio::test]
async fn admin_stats_and_devices_are_org_scoped() {
    let repo = InMemoryAdminRepo::default();
    repo.stats.lock().unwrap().insert(
        "org-1".to_string(),
        app::DashboardStats {
            total_devices: 2,
            active_devices: 1,
            violations_24h: 3,
            events_24h: 10,
            policies_active: 4,
            pending_exceptions: 1,
            violations_by_category: vec![app::CategoryCount {
                category: "secret".into(),
                warn: 1,
                block: 2,
            }],
        },
    );
    repo.devices.lock().unwrap().insert(
        "org-1".to_string(),
        vec![app::DeviceDetail {
            summary: app::DeviceSummary {
                device_id: "dev-1".into(),
                hostname: "mac".into(),
                platform: "macos".into(),
                agent_version: "0.1.0".into(),
                status: "active".into(),
                last_seen_ms: Some(123),
                model: Some("MacBookPro18,3".into()),
                os_version: Some("macOS".into()),
                last_user: Some("user@example.com".into()),
                ip_address: Some("10.0.0.1".into()),
            },
            hostname_full: "mac.corp.example.com".into(),
            enrolled_by: "admin@example.com".into(),
            chain_head: Some("h1".into()),
            chain_count: 1,
        }],
    );

    let stats = handle_admin_stats(&repo, "org-1").await.unwrap();
    assert_eq!(stats.total_devices, 2);
    assert_eq!(stats.violations_by_category.len(), 1);
    assert_eq!(stats.violations_by_category[0].category, "secret");
    assert_eq!(stats.violations_by_category[0].block, 2);
    let list = handle_admin_device_list(
        &repo,
        "org-1",
        AdminPageQuery {
            page: 1,
            per_page: 10,
        },
    )
    .await
    .unwrap();
    assert_eq!(list.items.len(), 1);
    let detail = handle_admin_device_get(&repo, "org-1", "dev-1")
        .await
        .unwrap();
    assert_eq!(detail.summary.device_id, "dev-1");
    handle_admin_device_delete(&repo, "org-1", "dev-1")
        .await
        .unwrap();
    let updated = handle_admin_device_get(&repo, "org-1", "dev-1")
        .await
        .unwrap();
    assert_eq!(updated.summary.status, "deactivated");
}

#[tokio::test]
async fn admin_device_delete_fails_closed_when_missing() {
    let repo = InMemoryAdminRepo::default();
    let err = handle_admin_device_delete(&repo, "org-1", "missing")
        .await
        .unwrap_err();
    assert_eq!(err.status(), 404);
}

#[tokio::test]
async fn audit_viewer_filters_matched_rule_id() {
    let repo = InMemoryAuditRepo::default();
    repo.events.lock().unwrap().insert(
        "org-1".to_string(),
        vec![app::AuditEventDetail {
            event: audit_core::AuditEvent {
                matched_rule_id: Some("rule-1".into()),
                ..sample_event("dev-1", "evt-1", 100)
            },
        }],
    );

    let detail = handle_admin_audit_detail(&repo, "org-1", "evt-1", true)
        .await
        .unwrap();
    assert!(detail.event.matched_rule_id.is_none());
    assert!(detail.event.findings.is_empty());
}

#[tokio::test]
async fn audit_search_and_chain_are_bounded() {
    let repo = InMemoryAuditRepo::default();
    repo.events.lock().unwrap().insert(
        "org-1".to_string(),
        (0..3)
            .map(|i| app::AuditEventDetail {
                event: sample_event("dev-1", &format!("evt-{i}"), 100 + i),
            })
            .collect(),
    );
    let page = handle_admin_audit_list(
        &repo,
        "org-1",
        AdminSearchQuery {
            page: 1,
            per_page: 2,
            date_from_ms: None,
            date_to_ms: None,
            decision: None,
            risk_level: None,
            user_id: None,
            category: None,
            device_id: None,
            search: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.items.len(), 2);
    let violations = handle_admin_audit_violation_list(
        &repo,
        "org-1",
        AdminSearchQuery {
            page: 1,
            per_page: 10,
            date_from_ms: None,
            date_to_ms: None,
            decision: None,
            risk_level: None,
            user_id: None,
            category: None,
            device_id: None,
            search: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(violations.items.len(), 0);
    let chain = handle_admin_audit_chain(&repo, "org-1", "dev-1", None, 0, 100)
        .await
        .unwrap();
    assert_eq!(chain.events.len(), 3);
}

#[tokio::test]
async fn audit_summaries_carry_category_and_reason_and_filter_by_category() {
    let repo = InMemoryAuditRepo::default();
    let finding = audit_core::AuditFinding {
        detector_id: "secret.aws_access_key".into(),
        category: pe_core::Category::Secret,
        kind: "aws_access_key".into(),
        span_start: 0,
        span_end: 8,
        confidence: 0.99,
        severity: pe_core::Severity::High,
        redacted_preview: "AKIA****".into(),
        meta: Default::default(),
    };
    repo.events.lock().unwrap().insert(
        "org-1".to_string(),
        vec![
            // Engine-provided top-level category + reason.
            app::AuditEventDetail {
                event: audit_core::AuditEvent {
                    category: Some("pii".into()),
                    reason: Some("SSN detected in prompt".into()),
                    ..sample_event("dev-1", "evt-pii", 100)
                },
            },
            // No top-level category: derived from the highest-severity finding.
            app::AuditEventDetail {
                event: audit_core::AuditEvent {
                    findings: vec![finding],
                    ..sample_event("dev-1", "evt-secret", 200)
                },
            },
            // Neither category nor findings: summary category stays None.
            app::AuditEventDetail {
                event: sample_event("dev-1", "evt-none", 300),
            },
        ],
    );

    let all = handle_admin_audit_list(
        &repo,
        "org-1",
        AdminSearchQuery {
            page: 1,
            per_page: 10,
            date_from_ms: None,
            date_to_ms: None,
            decision: None,
            risk_level: None,
            user_id: None,
            category: None,
            device_id: None,
            search: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(all.items.len(), 3);
    let by_id = |id: &str| all.items.iter().find(|i| i.event_id == id).unwrap();
    assert_eq!(by_id("evt-pii").category.as_deref(), Some("pii"));
    assert_eq!(
        by_id("evt-pii").reason.as_deref(),
        Some("SSN detected in prompt")
    );
    assert_eq!(by_id("evt-secret").category.as_deref(), Some("secret"));
    assert_eq!(by_id("evt-none").category, None);
    assert_eq!(by_id("evt-none").reason, None);

    let filtered = handle_admin_audit_list(
        &repo,
        "org-1",
        AdminSearchQuery {
            page: 1,
            per_page: 10,
            date_from_ms: None,
            date_to_ms: None,
            decision: None,
            risk_level: None,
            user_id: None,
            category: Some("secret".into()),
            device_id: None,
            search: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(filtered.items.len(), 1);
    assert_eq!(filtered.items[0].event_id, "evt-secret");
}

#[test]
fn role_hierarchy_blocks_invalid_user_creation() {
    assert!(can_create_user("super_admin", "org_admin"));
    assert!(can_create_user("org_admin", "auditor"));
    assert!(!can_create_user("org_admin", "super_admin"));
    assert!(!can_create_user("auditor", "viewer"));
}

#[tokio::test]
async fn admin_users_are_org_scoped_and_paginated() {
    let users = InMemoryUsers::default();
    let identity = FakeUserIdentity;
    handle_admin_user_create(
        &users,
        &identity,
        "org-1",
        "org_admin",
        UserCreateRequest {
            email: "auditor@corp.example.com".into(),
            role: "auditor".into(),
        },
    )
    .await
    .unwrap();
    handle_admin_user_create(
        &users,
        &identity,
        "org-2",
        "super_admin",
        UserCreateRequest {
            email: "viewer@other.example.com".into(),
            role: "viewer".into(),
        },
    )
    .await
    .unwrap();

    let page = handle_admin_user_list(
        &users,
        "org-1",
        UserListQuery {
            page: 1,
            per_page: 10,
            role: None,
            status: None,
            search: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].email, "auditor@corp.example.com");

    let err = handle_admin_user_create(
        &users,
        &identity,
        "org-1",
        "org_admin",
        UserCreateRequest {
            email: "bad@corp.example.com".into(),
            role: "super_admin".into(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), 401);
}

#[tokio::test]
async fn admin_user_delete_fails_closed_when_missing() {
    let users = InMemoryUsers::default();
    let identity = FakeUserIdentity;
    let err = handle_admin_user_delete(&users, &identity, "org-1", "missing@corp.example.com")
        .await
        .unwrap_err();
    assert_eq!(err.status(), 404);
}

#[tokio::test]
async fn admin_settings_update_merges_and_validates() {
    let settings = InMemorySettings::default();
    let current = handle_admin_settings_get(&settings, "org-1").await.unwrap();
    assert_eq!(current.enrollment_mode, "invite");

    let updated = handle_admin_settings_put(
        &settings,
        "org-1",
        "org_admin",
        SettingsUpdateRequest {
            org_name: Some("Acme Corp".into()),
            enrollment_mode: Some("closed".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.org_name, "Acme Corp");
    assert_eq!(updated.enrollment_mode, "closed");

    let err = handle_admin_settings_put(
        &settings,
        "org-1",
        "org_admin",
        SettingsUpdateRequest {
            data_retention_days: Some(3),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), 400);
}
