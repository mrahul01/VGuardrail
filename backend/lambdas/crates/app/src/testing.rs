//! In-memory implementations of the ports, for unit tests and the native e2e
//! harness. Deterministic and dependency-free (no AWS).

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use async_trait::async_trait;
use audit_core::{AuditEvent, EventType};
use pe_core::{Action, Classification, RiskLevel};

use crate::ports::{
    AppendOutcome, ArchiveStore, AuditAdminRepository, AuditEventDetail, AuditEventSummary,
    AuditSearchQuery, AuditStore, ChainHead, ChainSegment, DashboardAdminRepository,
    DashboardStats, DeviceAdminRepository, DeviceDetail, DeviceDirectory, DeviceIdentityIssuer,
    DeviceRecord, DeviceSummary, EnrollmentVerifier, IdempotencyStore, OrgSettings, Page,
    PolicyArtifact, PolicyRepo, SettingsAdminRepository, SettingsUpdateRequest, StoreError, Tokens,
    UploadRecord, UserAdminRepository, UserIdentityAdmin, UserListQuery, UserSummary,
};

/// In-memory audit store with a per-device hash chain.
#[derive(Default)]
pub struct InMemoryAuditStore {
    state: Mutex<AuditState>,
}

#[derive(Default)]
struct AuditState {
    seen_event_ids: HashSet<String>,
    heads: HashMap<String, ChainHead>,
    /// Events in insertion order per device (for chain inspection).
    chains: HashMap<String, Vec<AuditEvent>>,
}

impl InMemoryAuditStore {
    /// All stored events for a device, in chain order.
    pub fn chain_for(&self, device_id: &str) -> Vec<AuditEvent> {
        self.state
            .lock()
            .unwrap()
            .chains
            .get(device_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Total distinct events stored.
    pub fn stored_count(&self) -> usize {
        self.state.lock().unwrap().seen_event_ids.len()
    }
}

#[async_trait]
impl AuditStore for InMemoryAuditStore {
    async fn chain_head(&self, device_id: &str) -> Result<Option<ChainHead>, StoreError> {
        Ok(self.state.lock().unwrap().heads.get(device_id).cloned())
    }

    async fn append_if_head(
        &self,
        event: &AuditEvent,
        expected_head: Option<&str>,
        new_head: &ChainHead,
    ) -> Result<AppendOutcome, StoreError> {
        let mut s = self.state.lock().unwrap();
        if s.seen_event_ids.contains(&event.event_id) {
            return Ok(AppendOutcome::DuplicateEvent);
        }
        let current = s.heads.get(&event.device_id).map(|h| h.hash.clone());
        if current.as_deref() != expected_head {
            return Ok(AppendOutcome::ChainConflict);
        }
        s.seen_event_ids.insert(event.event_id.clone());
        s.heads.insert(event.device_id.clone(), new_head.clone());
        s.chains
            .entry(event.device_id.clone())
            .or_default()
            .push(event.clone());
        Ok(AppendOutcome::Stored)
    }
}

/// In-memory archive that records the raw batches.
#[derive(Default)]
pub struct InMemoryArchive {
    objects: Mutex<Vec<(String, Vec<u8>)>>,
}

impl InMemoryArchive {
    /// Number of archived batches.
    pub fn count(&self) -> usize {
        self.objects.lock().unwrap().len()
    }
}

#[async_trait]
impl ArchiveStore for InMemoryArchive {
    async fn put_raw(
        &self,
        org_id: &str,
        device_id: &str,
        upload_id: &str,
        body: &[u8],
    ) -> Result<String, StoreError> {
        let key = format!("org={org_id}/device={device_id}/{upload_id}.json");
        self.objects
            .lock()
            .unwrap()
            .push((key.clone(), body.to_vec()));
        Ok(key)
    }
}

/// In-memory idempotency record store.
#[derive(Default)]
pub struct InMemoryIdempotency {
    records: Mutex<HashMap<String, UploadRecord>>,
}

#[async_trait]
impl IdempotencyStore for InMemoryIdempotency {
    async fn get(&self, upload_id: &str) -> Result<Option<UploadRecord>, StoreError> {
        Ok(self.records.lock().unwrap().get(upload_id).cloned())
    }
    async fn put(
        &self,
        upload_id: &str,
        _device_id: &str,
        record: &UploadRecord,
    ) -> Result<(), StoreError> {
        self.records
            .lock()
            .unwrap()
            .insert(upload_id.to_string(), record.clone());
        Ok(())
    }
}

/// Enrollment verifier backed by a fixed token→org map.
pub struct StaticEnrollment {
    tokens: HashMap<String, String>,
}

impl StaticEnrollment {
    /// Builds a verifier that accepts `token` for `org_id`.
    pub fn single(token: &str, org_id: &str) -> Self {
        let mut tokens = HashMap::new();
        tokens.insert(token.to_string(), org_id.to_string());
        Self { tokens }
    }
}

#[async_trait]
impl EnrollmentVerifier for StaticEnrollment {
    async fn resolve_org(&self, token: &str) -> Result<Option<String>, StoreError> {
        Ok(self.tokens.get(token).cloned())
    }
}

/// In-memory device directory.
#[derive(Default)]
pub struct InMemoryDevices {
    devices: Mutex<HashMap<String, DeviceRecord>>,
}

impl InMemoryDevices {
    /// Number of registered devices.
    pub fn count(&self) -> usize {
        self.devices.lock().unwrap().len()
    }
}

#[async_trait]
impl DeviceDirectory for InMemoryDevices {
    async fn upsert(&self, record: &DeviceRecord) -> Result<bool, StoreError> {
        let mut d = self.devices.lock().unwrap();
        let is_new = !d.contains_key(&record.device_id);
        d.insert(record.device_id.clone(), record.clone());
        Ok(is_new)
    }
}

/// Identity issuer that returns deterministic tokens.
#[derive(Default)]
pub struct FakeIdentityIssuer;

#[async_trait]
impl DeviceIdentityIssuer for FakeIdentityIssuer {
    async fn ensure_user_and_issue(
        &self,
        device_id: &str,
        org_id: &str,
    ) -> Result<Tokens, StoreError> {
        Ok(Tokens {
            access_token: format!("access.{org_id}.{device_id}"),
            refresh_token: format!("refresh.{device_id}"),
            expires_in: 3600,
        })
    }
}

/// Policy repo holding a single bundle per org.
#[derive(Default)]
pub struct InMemoryPolicies {
    by_org: Mutex<HashMap<String, PolicyArtifact>>,
}

impl InMemoryPolicies {
    /// Publishes a bundle for an org.
    pub fn publish(&self, org_id: &str, version: u32, bytes: Vec<u8>) {
        self.by_org
            .lock()
            .unwrap()
            .insert(org_id.to_string(), PolicyArtifact { version, bytes });
    }
}

#[async_trait]
impl PolicyRepo for InMemoryPolicies {
    async fn latest(&self, org_id: &str) -> Result<Option<PolicyArtifact>, StoreError> {
        Ok(self.by_org.lock().unwrap().get(org_id).cloned())
    }
}

/// In-memory admin repository for dashboard stats and device inventory tests.
#[derive(Default)]
pub struct InMemoryAdminRepo {
    /// Stats by org.
    pub stats: Mutex<HashMap<String, DashboardStats>>,
    /// Devices by org.
    pub devices: Mutex<HashMap<String, Vec<DeviceDetail>>>,
}

/// In-memory audit repo for dashboard search/detail/chain tests.
#[derive(Default)]
pub struct InMemoryAuditRepo {
    /// Events by org.
    pub events: Mutex<HashMap<String, Vec<AuditEventDetail>>>,
}

#[async_trait]
impl DashboardAdminRepository for InMemoryAdminRepo {
    async fn get_stats(&self, org_id: &str) -> Result<DashboardStats, StoreError> {
        Ok(self
            .stats
            .lock()
            .unwrap()
            .get(org_id)
            .cloned()
            .unwrap_or(DashboardStats {
                total_devices: 0,
                active_devices: 0,
                violations_24h: 0,
                events_24h: 0,
                policies_active: 0,
                pending_exceptions: 0,
                violations_by_category: vec![],
            }))
    }
}

#[async_trait]
impl DeviceAdminRepository for InMemoryAdminRepo {
    async fn list_devices(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<DeviceSummary>, StoreError> {
        let devices = self.devices.lock().unwrap();
        let rows = devices.get(org_id).cloned().unwrap_or_default();
        let total = rows.len() as u64;
        let start = ((page.max(1) - 1) * per_page.max(1)) as usize;
        let end = usize::min(start + per_page.max(1) as usize, rows.len());
        let items = rows
            .into_iter()
            .skip(start)
            .take(end.saturating_sub(start))
            .map(|d| d.summary)
            .collect::<Vec<_>>();
        Ok(Page {
            total,
            items,
            page: page.max(1),
            per_page: per_page.max(1),
            next_token: None,
        })
    }

    async fn get_device(
        &self,
        org_id: &str,
        device_id: &str,
    ) -> Result<Option<DeviceDetail>, StoreError> {
        Ok(self.devices.lock().unwrap().get(org_id).and_then(|rows| {
            rows.iter()
                .find(|d| d.summary.device_id == device_id)
                .cloned()
        }))
    }

    async fn deactivate_device(&self, org_id: &str, device_id: &str) -> Result<bool, StoreError> {
        let mut devices = self.devices.lock().unwrap();
        let Some(rows) = devices.get_mut(org_id) else {
            return Ok(false);
        };
        if let Some(device) = rows.iter_mut().find(|d| d.summary.device_id == device_id) {
            device.summary.status = "deactivated".to_string();
            return Ok(true);
        }
        Ok(false)
    }
}

#[async_trait]
impl AuditAdminRepository for InMemoryAuditRepo {
    async fn search_audit(
        &self,
        org_id: &str,
        query: AuditSearchQuery,
    ) -> Result<Page<AuditEventSummary>, StoreError> {
        let rows = self.events.lock().unwrap();
        let mut items = rows.get(org_id).cloned().unwrap_or_default();
        items.retain(|d| {
            let e = &d.event;
            query.date_from_ms.is_none_or(|from| e.timestamp_ms >= from)
                && query.date_to_ms.is_none_or(|to| e.timestamp_ms <= to)
                && query
                    .decision
                    .as_ref()
                    .is_none_or(|x| format!("{:?}", e.decision).eq_ignore_ascii_case(x))
                && query
                    .risk_level
                    .as_ref()
                    .is_none_or(|x| format!("{:?}", e.risk_level).eq_ignore_ascii_case(x))
                && query.user_id.as_ref().is_none_or(|x| &e.user_id == x)
                && query
                    .category
                    .as_ref()
                    .is_none_or(|x| e.effective_category().as_deref() == Some(x.as_str()))
                && query.device_id.as_ref().is_none_or(|x| &e.device_id == x)
                && query.search.as_ref().is_none_or(|x| {
                    e.reason
                        .as_deref()
                        .is_some_and(|r| r.to_lowercase().contains(&x.to_lowercase()))
                        || e.device_id.contains(x.as_str())
                })
        });
        items.sort_by_key(|d| std::cmp::Reverse(d.event.timestamp_ms));
        let total = items.len() as u64;
        let start = ((query.page.max(1) - 1) * query.per_page.max(1)) as usize;
        let end = usize::min(start + query.per_page.max(1) as usize, items.len());
        let items = if start >= items.len() {
            vec![]
        } else {
            items[start..end]
                .iter()
                .map(|d| AuditEventSummary {
                    event_id: d.event.event_id.clone(),
                    device_id: d.event.device_id.clone(),
                    timestamp_ms: d.event.timestamp_ms,
                    decision: format!("{:?}", d.event.decision),
                    risk_level: format!("{:?}", d.event.risk_level),
                    event_type: format!("{:?}", d.event.event_type),
                    provider: d.event.provider.clone(),
                    category: d.event.effective_category(),
                    reason: d.event.reason.clone(),
                })
                .collect()
        };
        Ok(Page {
            items,
            total,
            page: query.page.max(1),
            per_page: query.per_page.max(1),
            next_token: None,
        })
    }

    async fn get_audit_event(
        &self,
        org_id: &str,
        event_id: &str,
    ) -> Result<Option<AuditEventDetail>, StoreError> {
        Ok(self
            .events
            .lock()
            .unwrap()
            .get(org_id)
            .and_then(|rows| rows.iter().find(|d| d.event.event_id == event_id).cloned()))
    }

    async fn verify_chain_segment(
        &self,
        org_id: &str,
        device_id: &str,
        _start_event_id: Option<&str>,
        offset: u64,
        max_events: u64,
    ) -> Result<ChainSegment, StoreError> {
        let rows = self.events.lock().unwrap();
        let mut items: Vec<_> = rows
            .get(org_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|d| d.event.device_id == device_id)
            .collect();
        items.sort_by_key(|d| std::cmp::Reverse(d.event.timestamp_ms));
        let start = offset as usize;
        let end = usize::min(start + max_events as usize, items.len());
        let events = if start >= items.len() {
            vec![]
        } else {
            items[start..end].to_vec()
        };
        Ok(ChainSegment {
            next_offset: if end < items.len() {
                Some(end as u64)
            } else {
                None
            },
            complete: end >= items.len(),
            events,
        })
    }
}

/// Builds a minimal valid audit event for tests.
#[must_use]
pub fn sample_event(device_id: &str, event_id: &str, ts: i64) -> AuditEvent {
    AuditEvent {
        event_id: event_id.to_string(),
        schema: "vguardrail.event/v1".to_string(),
        event_type: EventType::PolicyEvaluated,
        timestamp_ms: ts,
        user_id: "u1".to_string(),
        device_id: device_id.to_string(),
        source: None,
        provider: Some("openai".to_string()),
        model: None,
        app: None,
        decision: Action::Allow,
        risk_level: RiskLevel::Low,
        classification: Classification::Public,
        policy_version: 1,
        matched_rule_id: None,
        category: None,
        reason: None,
        suppressions: vec![],
        incomplete: false,
        findings: vec![],
        event_hash: None,
        previous_event_hash: None,
    }
}

/// Serializes a batch body `{ "events": [...] }` from events.
#[must_use]
pub fn batch_body(events: &[AuditEvent]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "events": events })).unwrap()
}

/// In-memory user directory for admin tests.
#[derive(Default)]
pub struct InMemoryUsers {
    users: Mutex<HashMap<String, Vec<UserSummary>>>,
}

#[async_trait]
impl UserAdminRepository for InMemoryUsers {
    async fn list_users(
        &self,
        org_id: &str,
        query: UserListQuery,
    ) -> Result<Page<UserSummary>, StoreError> {
        let mut items = self
            .users
            .lock()
            .unwrap()
            .get(org_id)
            .cloned()
            .unwrap_or_default();
        if let Some(role) = &query.role {
            items.retain(|u| u.role == *role);
        }
        if let Some(status) = &query.status {
            items.retain(|u| u.status == *status);
        }
        if let Some(search) = &query.search {
            let needle = search.to_lowercase();
            items.retain(|u| u.email.to_lowercase().contains(&needle));
        }
        let total = items.len() as u64;
        let start = ((query.page.max(1) - 1) * query.per_page.max(1)) as usize;
        let end = usize::min(start + query.per_page.max(1) as usize, items.len());
        Ok(Page {
            items: if start >= items.len() {
                vec![]
            } else {
                items[start..end].to_vec()
            },
            total,
            page: query.page.max(1),
            per_page: query.per_page.max(1),
            next_token: None,
        })
    }

    async fn get_user(
        &self,
        org_id: &str,
        user_id: &str,
    ) -> Result<Option<UserSummary>, StoreError> {
        Ok(self
            .users
            .lock()
            .unwrap()
            .get(org_id)
            .and_then(|rows| rows.iter().find(|u| u.id == user_id).cloned()))
    }

    async fn put_user(&self, org_id: &str, user: &UserSummary) -> Result<(), StoreError> {
        let mut users = self.users.lock().unwrap();
        let rows = users.entry(org_id.to_string()).or_default();
        if let Some(existing) = rows.iter_mut().find(|u| u.id == user.id) {
            *existing = user.clone();
        } else {
            rows.push(user.clone());
        }
        Ok(())
    }

    async fn mark_disabled(&self, org_id: &str, user_id: &str) -> Result<bool, StoreError> {
        let mut users = self.users.lock().unwrap();
        let Some(rows) = users.get_mut(org_id) else {
            return Ok(false);
        };
        if let Some(user) = rows.iter_mut().find(|u| u.id == user_id) {
            user.status = "disabled".into();
            return Ok(true);
        }
        Ok(false)
    }
}

/// Fake Cognito user admin for tests.
#[derive(Default)]
pub struct FakeUserIdentity;

#[async_trait]
impl UserIdentityAdmin for FakeUserIdentity {
    async fn invite_user(
        &self,
        email: &str,
        _org_id: &str,
        _role: &str,
    ) -> Result<String, StoreError> {
        Ok(email.to_lowercase())
    }

    async fn delete_user(&self, _user_id: &str) -> Result<(), StoreError> {
        Ok(())
    }
}

/// In-memory org settings for admin tests.
#[derive(Default)]
pub struct InMemorySettings {
    settings: Mutex<HashMap<String, OrgSettings>>,
    audits: Mutex<Vec<(String, String, String)>>,
}

#[async_trait]
impl SettingsAdminRepository for InMemorySettings {
    async fn get_settings(&self, org_id: &str) -> Result<OrgSettings, StoreError> {
        Ok(self
            .settings
            .lock()
            .unwrap()
            .get(org_id)
            .cloned()
            .unwrap_or(OrgSettings {
                org_id: org_id.to_string(),
                org_name: org_id.to_string(),
                default_policy_id: "default".into(),
                enrollment_mode: "invite".into(),
                data_retention_days: 90,
                email_alerts: true,
                slack_webhook_url: None,
            }))
    }

    async fn update_settings(
        &self,
        org_id: &str,
        patch: SettingsUpdateRequest,
        actor: &str,
    ) -> Result<OrgSettings, StoreError> {
        let current = self.get_settings(org_id).await?;
        let updated = OrgSettings {
            org_name: patch.org_name.unwrap_or(current.org_name),
            default_policy_id: patch.default_policy_id.unwrap_or(current.default_policy_id),
            enrollment_mode: patch.enrollment_mode.unwrap_or(current.enrollment_mode),
            data_retention_days: patch
                .data_retention_days
                .unwrap_or(current.data_retention_days),
            email_alerts: patch.email_alerts.unwrap_or(current.email_alerts),
            slack_webhook_url: patch.slack_webhook_url.or(current.slack_webhook_url),
            ..current
        };
        self.settings
            .lock()
            .unwrap()
            .insert(org_id.to_string(), updated.clone());
        self.audits
            .lock()
            .unwrap()
            .push((org_id.to_string(), actor.to_string(), "update".into()));
        Ok(updated)
    }
}
