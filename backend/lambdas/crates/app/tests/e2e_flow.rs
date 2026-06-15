//! Native end-to-end validation of the full agent flow through all four
//! handlers in sequence, over the in-memory fakes:
//!
//!   register → publish policy → policy download → event upload → storage
//!
//! plus retry idempotency and chain-integrity verification. This is the
//! Docker-free equivalent of the LocalStack e2e (which needs the Docker daemon).

use app::testing::{
    batch_body, sample_event, FakeIdentityIssuer, InMemoryArchive, InMemoryAuditStore,
    InMemoryDevices, InMemoryIdempotency, InMemoryPolicies, StaticEnrollment,
};
use app::{
    handle_events_batch, handle_health, handle_policy_latest, handle_register, PolicyOutcome,
    RegisterRequest, RequestContext,
};
use audit_core::{verify_event_hash, GENESIS_PREV};

#[tokio::test]
async fn full_agent_flow_end_to_end() {
    // ── 0. Health ────────────────────────────────────────────────────────────
    assert_eq!(handle_health("0.1.0", "t").status, "healthy");

    // ── 1. Register a device (enrollment-gated) ──────────────────────────────
    let enrollment = StaticEnrollment::single("org-1.secret", "org-1");
    let devices = InMemoryDevices::default();
    let identity = FakeIdentityIssuer;

    let reg = handle_register(
        &enrollment,
        &devices,
        &identity,
        Some("org-1.secret"),
        RegisterRequest {
            device_id: "dev-1".into(),
            hostname: "mac".into(),
            platform: "macos".into(),
            agent_version: "0.1.0".into(),
            model: None,
            os_version: None,
            username: None,
            hostname_full: None,
        },
        1_000,
    )
    .await
    .expect("register");
    assert_eq!(reg.org_id, "org-1");
    assert!(!reg.access_token.is_empty());
    assert_eq!(devices.count(), 1);

    let ctx = RequestContext {
        device_id: "dev-1".to_string(),
        org_id: reg.org_id.clone(),
    };

    // ── 2. Publish + download the policy ─────────────────────────────────────
    let policies = InMemoryPolicies::default();
    policies.publish(
        "org-1",
        3,
        br#"{"schema":"vguardrail.policy/v1","version":3}"#.to_vec(),
    );

    match handle_policy_latest(&policies, &ctx.org_id, None, None)
        .await
        .expect("policy")
    {
        PolicyOutcome::Bundle { version, bytes } => {
            assert_eq!(version, 3);
            assert!(!bytes.is_empty());
        }
        PolicyOutcome::NotModified => panic!("expected bundle"),
    }
    // Conditional GET with the held version → 304.
    assert!(matches!(
        handle_policy_latest(&policies, &ctx.org_id, Some("3"), None)
            .await
            .unwrap(),
        PolicyOutcome::NotModified
    ));

    // ── 3. Upload audit events (tamper-evident, idempotent) ──────────────────
    let store = InMemoryAuditStore::default();
    let archive = InMemoryArchive::default();
    let idem = InMemoryIdempotency::default();

    let body = batch_body(&[
        sample_event("dev-1", "e1", 100),
        sample_event("dev-1", "e2", 200),
        sample_event("dev-1", "e3", 300),
    ]);

    let first = handle_events_batch(&store, &archive, &idem, &ctx, None, &body)
        .await
        .expect("upload");
    assert_eq!(first.accepted, 3);
    assert_eq!(first.rejected, 0);
    assert!(!first.replayed);

    // Retry the same batch → idempotent replay, nothing re-stored.
    let retry = handle_events_batch(&store, &archive, &idem, &ctx, None, &body)
        .await
        .expect("retry");
    assert!(retry.replayed);
    assert_eq!(retry.upload_id, first.upload_id);
    assert_eq!(store.stored_count(), 3, "no duplicate audit records");
    assert_eq!(
        archive.count(),
        1,
        "replay short-circuits before re-archiving"
    );

    // ── 4. Verify storage: the per-device hash chain is intact ───────────────
    let chain = store.chain_for("dev-1");
    assert_eq!(chain.len(), 3);
    let mut prev = GENESIS_PREV.to_string();
    for event in &chain {
        assert_eq!(event.previous_event_hash.as_deref(), Some(prev.as_str()));
        assert!(verify_event_hash(event));
        prev = event.event_hash.clone().unwrap();
    }

    // A later overlapping batch dedups e3 and chains e4 off the live head.
    let body2 = batch_body(&[
        sample_event("dev-1", "e3", 300),
        sample_event("dev-1", "e4", 400),
    ]);
    let third = handle_events_batch(&store, &archive, &idem, &ctx, None, &body2)
        .await
        .unwrap();
    assert_eq!(third.accepted, 2);
    assert_eq!(store.stored_count(), 4);
    let chain = store.chain_for("dev-1");
    let mut prev = GENESIS_PREV.to_string();
    for event in &chain {
        assert_eq!(event.previous_event_hash.as_deref(), Some(prev.as_str()));
        assert!(verify_event_hash(event));
        prev = event.event_hash.clone().unwrap();
    }
}
