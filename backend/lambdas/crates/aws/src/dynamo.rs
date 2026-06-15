//! DynamoDB adapters: the audit store (atomic dedup + chain advance), the
//! idempotency record store, the policy repo, and the device directory.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use app::{
    AppendOutcome, AuditAdminRepository, AuditEventDetail, AuditEventSummary, AuditSearchQuery,
    AuditStore, CategoryCount, ChainHead, ChainSegment, DashboardAdminRepository, DashboardStats,
    DeviceAdminRepository, DeviceDetail, DeviceDirectory, DeviceInventory, DeviceInventoryStore,
    DeviceRecord, DeviceSummary,
    ExceptionAdminRepository, ExceptionDetail, ExceptionSummary, IdempotencyStore, OrgSettings,
    Page, PolicyAdminRepository, PolicyArtifact, PolicyDetail, PolicyRepo, PolicySummary,
    SettingsAdminRepository, SettingsUpdateRequest, StoreError, UploadRecord, UserAdminRepository,
    UserListQuery, UserSummary,
};
use async_trait::async_trait;
use audit_core::AuditEvent;
use aws_sdk_dynamodb::operation::transact_write_items::TransactWriteItemsError;
use aws_sdk_dynamodb::types::{AttributeValue, Put, TransactWriteItem};
use aws_sdk_dynamodb::Client;
use std::cmp::Reverse;

/// Hot-index retention for audit/idempotency rows (S3 holds the 7-year archive).
const TTL_SECONDS: i64 = 90 * 24 * 60 * 60;

fn s(value: impl Into<String>) -> AttributeValue {
    AttributeValue::S(value.into())
}
fn n(value: impl ToString) -> AttributeValue {
    AttributeValue::N(value.to_string())
}
fn backend(msg: impl ToString) -> StoreError {
    StoreError::Backend(msg.to_string())
}
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn yyyy_mm_from_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let (y, m, _) = civil_from_days(days);
    format!("{y:04}{m:02}")
}

fn parse_s(item: &HashMap<String, AttributeValue>, key: &str) -> String {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .cloned()
        .unwrap_or_default()
}

fn parse_s_opt(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .filter(|v| !v.is_empty())
        .cloned()
}

fn parse_n<T: std::str::FromStr>(item: &HashMap<String, AttributeValue>, key: &str) -> Option<T> {
    item.get(key)
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse::<T>().ok())
}

fn add_month(mut year: i64, mut month: u32, delta: i32) -> (i64, u32) {
    let mut total = month as i32 + delta;
    while total > 12 {
        year += 1;
        total -= 12;
    }
    while total < 1 {
        year -= 1;
        total += 12;
    }
    month = total as u32;
    (year, month)
}

fn yyyymm_range(date_from_ms: Option<i64>, date_to_ms: Option<i64>) -> Vec<String> {
    let start = date_from_ms.unwrap_or_else(now_secs) * 1000;
    let end = date_to_ms.unwrap_or_else(now_secs) * 1000;
    let (mut year, mut month, _) = civil_from_days(start.div_euclid(86_400_000));
    let (end_y, end_m, _) = civil_from_days(end.div_euclid(86_400_000));
    let mut out = Vec::new();
    loop {
        out.push(format!("{year:04}{month:02}"));
        if year == end_y && month == end_m {
            break;
        }
        let (ny, nm) = add_month(year, month, 1);
        year = ny;
        month = nm;
    }
    out
}

fn recent_months(count: usize) -> Vec<String> {
    let mut out = Vec::new();
    let (mut year, mut month, _) = civil_from_days(now_secs().div_euclid(86_400));
    for _ in 0..count {
        out.push(format!("{year:04}{month:02}"));
        let (ny, nm) = add_month(year, month, -1);
        year = ny;
        month = nm;
    }
    out
}

fn audit_summary_from_item(item: &HashMap<String, AttributeValue>) -> AuditEventSummary {
    AuditEventSummary {
        event_id: parse_s(item, "event_id"),
        device_id: parse_s(item, "device_id"),
        timestamp_ms: parse_n(item, "timestamp_ms").unwrap_or_default(),
        decision: parse_s(item, "decision"),
        risk_level: parse_s(item, "risk_level"),
        event_type: parse_s(item, "type"),
        provider: item.get("provider").and_then(|v| v.as_s().ok()).cloned(),
        category: item.get("category").and_then(|v| v.as_s().ok()).cloned(),
        reason: item.get("reason").and_then(|v| v.as_s().ok()).cloned(),
    }
}

fn audit_detail_from_item(item: &HashMap<String, AttributeValue>) -> Option<AuditEventDetail> {
    let payload = item.get("payload").and_then(|v| v.as_s().ok())?;
    serde_json::from_str::<AuditEvent>(payload)
        .ok()
        .map(|event| AuditEventDetail { event })
}

fn policy_summary_from_item(item: &HashMap<String, AttributeValue>) -> PolicySummary {
    let version: u32 = parse_n(item, "version").unwrap_or(0);
    // Display metadata may live as explicit attributes (seeded/managed items)
    // or only inside bundle_json (agent-published bundles) — try both.
    let bundle: Option<serde_json::Value> = item
        .get("bundle_json")
        .and_then(|v| v.as_s().ok())
        .and_then(|raw| serde_json::from_str(raw).ok());
    let from_bundle = |key: &str| -> Option<String> {
        bundle
            .as_ref()
            .and_then(|b| b.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let name = parse_s_opt(item, "name")
        .or_else(|| from_bundle("name"))
        .unwrap_or_else(|| format!("Policy v{version}"));
    let default_action = parse_s_opt(item, "default_action")
        .or_else(|| from_bundle("default_action"))
        .unwrap_or_else(|| "warn".to_string());
    let rule_count: u32 = parse_n(item, "rule_count").unwrap_or_else(|| {
        bundle
            .as_ref()
            .and_then(|b| b.get("rules"))
            .and_then(|r| r.as_array())
            .map(|r| r.len() as u32)
            .unwrap_or(0)
    });
    PolicySummary {
        version,
        status: parse_s(item, "status"),
        published_at_ms: parse_n(item, "published_at_ms"),
        policy_id: parse_s_opt(item, "policy_id").unwrap_or_else(|| version.to_string()),
        name,
        default_action,
        rule_count,
        created_at_ms: parse_n(item, "created_at_ms").or_else(|| parse_n(item, "published_at_ms")),
    }
}

fn exception_summary_from_item(item: &HashMap<String, AttributeValue>) -> ExceptionSummary {
    ExceptionSummary {
        exception_id: parse_s(item, "exception_id"),
        rule_id: parse_s(item, "rule_id"),
        status: parse_s(item, "status"),
        requested_at_ms: parse_n(item, "requested_at_ms").unwrap_or_default(),
    }
}

// ── Audit store ──────────────────────────────────────────────────────────────

/// Audit store backed by the audit table. Built per request with the caller's
/// `org_id` (for the org-timeline GSI); the underlying client is reused.
pub struct DynamoAuditStore {
    client: Client,
    table: String,
    org_id: String,
}

impl DynamoAuditStore {
    /// Builds the store for a request.
    pub fn new(client: Client, table: impl Into<String>, org_id: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
            org_id: org_id.into(),
        }
    }
}

#[async_trait]
impl AuditStore for DynamoAuditStore {
    async fn chain_head(&self, device_id: &str) -> Result<Option<ChainHead>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("DEVICE#{device_id}")))
            .key("SK", s("CHAINHEAD"))
            .consistent_read(true)
            .send()
            .await
            .map_err(backend)?;

        let Some(item) = out.item() else {
            return Ok(None);
        };
        let hash = item
            .get("headHash")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();
        let event_id = item
            .get("headEventId")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_default();
        let count = item
            .get("count")
            .and_then(|v| v.as_n().ok())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0);
        Ok(Some(ChainHead {
            hash,
            event_id,
            count,
        }))
    }

    async fn append_if_head(
        &self,
        event: &AuditEvent,
        expected_head: Option<&str>,
        new_head: &ChainHead,
    ) -> Result<AppendOutcome, StoreError> {
        let device_pk = format!("DEVICE#{}", event.device_id);
        let event_sk = format!("TS#{:013}#{}", event.timestamp_ms, event.event_id);
        let shard = yyyy_mm_from_ms(event.timestamp_ms);
        let payload = serde_json::to_string(event).map_err(backend)?;
        let ttl = now_secs() + TTL_SECONDS;

        // 1. The audit event item — created iff event_id is new (idempotency).
        let mut ev_item: HashMap<String, AttributeValue> = HashMap::new();
        ev_item.insert("PK".into(), s(device_pk.clone()));
        ev_item.insert("SK".into(), s(event_sk.clone()));
        ev_item.insert("GSI1PK".into(), s(format!("ORG#{}#{}", self.org_id, shard)));
        ev_item.insert("GSI1SK".into(), s(event_sk.clone()));
        ev_item.insert(
            "GSI2PK".into(),
            s(format!(
                "ORG#{}#{}#DECISION#{:?}",
                self.org_id, shard, event.decision
            )),
        );
        ev_item.insert("GSI2SK".into(), s(event_sk.clone()));
        ev_item.insert(
            "GSI3PK".into(),
            s(format!(
                "ORG#{}#{}#RISK#{:?}",
                self.org_id, shard, event.risk_level
            )),
        );
        ev_item.insert("GSI3SK".into(), s(event_sk.clone()));
        if let Some(provider) = &event.provider {
            ev_item.insert(
                "GSI4PK".into(),
                s(format!(
                    "ORG#{}#{}#PROVIDER#{}",
                    self.org_id, shard, provider
                )),
            );
            ev_item.insert("GSI4SK".into(), s(event_sk.clone()));
        }
        if let Some(source) = &event.source {
            ev_item.insert(
                "GSI5PK".into(),
                s(format!("ORG#{}#{}#SOURCE#{:?}", self.org_id, shard, source)),
            );
            ev_item.insert("GSI5SK".into(), s(event_sk.clone()));
        }
        ev_item.insert("event_id".into(), s(event.event_id.clone()));
        ev_item.insert("org_id".into(), s(self.org_id.clone()));
        ev_item.insert("type".into(), s(format!("{:?}", event.event_type)));
        ev_item.insert("decision".into(), s(format!("{:?}", event.decision)));
        ev_item.insert("risk_level".into(), s(format!("{:?}", event.risk_level)));
        ev_item.insert(
            "event_hash".into(),
            s(event.event_hash.clone().unwrap_or_default()),
        );
        ev_item.insert(
            "previous_event_hash".into(),
            s(event.previous_event_hash.clone().unwrap_or_default()),
        );
        ev_item.insert("payload".into(), s(payload));
        ev_item.insert("ttl".into(), n(ttl));
        if let Some(p) = &event.provider {
            ev_item.insert("provider".into(), s(p.clone()));
        }
        // Denormalized for list/summary queries; falls back to the
        // highest-severity finding's category for events from engines that
        // don't emit a top-level category yet.
        if let Some(category) = event.effective_category() {
            ev_item.insert("category".into(), s(category));
        }
        if let Some(reason) = &event.reason {
            ev_item.insert("reason".into(), s(reason.clone()));
        }
        let ev_put = Put::builder()
            .table_name(&self.table)
            .set_item(Some(ev_item))
            .condition_expression("attribute_not_exists(PK)")
            .build()
            .map_err(backend)?;

        // 2. The chain head — advanced iff it still equals expected_head.
        let mut head_item: HashMap<String, AttributeValue> = HashMap::new();
        head_item.insert("PK".into(), s(device_pk));
        head_item.insert("SK".into(), s("CHAINHEAD"));
        head_item.insert("headHash".into(), s(new_head.hash.clone()));
        head_item.insert("headEventId".into(), s(new_head.event_id.clone()));
        head_item.insert("count".into(), n(new_head.count));

        let mut head_builder = Put::builder()
            .table_name(&self.table)
            .set_item(Some(head_item));
        head_builder = match expected_head {
            None => head_builder.condition_expression("attribute_not_exists(PK)"),
            Some(h) => head_builder
                .condition_expression("headHash = :expected")
                .expression_attribute_values(":expected", s(h.to_string())),
        };
        let head_put = head_builder.build().map_err(backend)?;

        let result = self
            .client
            .transact_write_items()
            .transact_items(TransactWriteItem::builder().put(ev_put).build())
            .transact_items(TransactWriteItem::builder().put(head_put).build())
            .send()
            .await;

        match result {
            Ok(_) => Ok(AppendOutcome::Stored),
            Err(err) => {
                if let Some(TransactWriteItemsError::TransactionCanceledException(tce)) =
                    err.as_service_error()
                {
                    let reasons = tce.cancellation_reasons();
                    let failed = |i: usize| {
                        reasons
                            .get(i)
                            .and_then(|r| r.code())
                            .is_some_and(|c| c == "ConditionalCheckFailed")
                    };
                    if failed(0) {
                        return Ok(AppendOutcome::DuplicateEvent);
                    }
                    if failed(1) {
                        return Ok(AppendOutcome::ChainConflict);
                    }
                }
                Err(backend(format!("transact_write_items: {err}")))
            }
        }
    }
}

// ── Idempotency store ────────────────────────────────────────────────────────

/// Idempotency records stored in the audit table (`UPLOAD#<id>`).
pub struct DynamoIdempotency {
    client: Client,
    table: String,
}

impl DynamoIdempotency {
    /// Builds the store.
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl IdempotencyStore for DynamoIdempotency {
    async fn get(&self, upload_id: &str) -> Result<Option<UploadRecord>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("UPLOAD#{upload_id}")))
            .key("SK", s("UPLOAD"))
            .send()
            .await
            .map_err(backend)?;
        let Some(item) = out.item() else {
            return Ok(None);
        };
        let accepted = item
            .get("accepted")
            .and_then(|v| v.as_n().ok())
            .and_then(|x| x.parse().ok())
            .unwrap_or(0);
        let rejected = item
            .get("rejected")
            .and_then(|v| v.as_n().ok())
            .and_then(|x| x.parse().ok())
            .unwrap_or(0);
        Ok(Some(UploadRecord { accepted, rejected }))
    }

    async fn put(
        &self,
        upload_id: &str,
        device_id: &str,
        record: &UploadRecord,
    ) -> Result<(), StoreError> {
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("UPLOAD#{upload_id}")))
            .item("SK", s("UPLOAD"))
            .item("device_id", s(device_id))
            .item("accepted", n(record.accepted))
            .item("rejected", n(record.rejected))
            .item("ttl", n(now_secs() + TTL_SECONDS))
            .send()
            .await
            .map_err(backend)?;
        Ok(())
    }
}

// ── Policy repo ──────────────────────────────────────────────────────────────

/// Latest-policy reads from the core table (`ORG#<org>` / `POLICY#LATEST`).
pub struct DynamoPolicyRepo {
    client: Client,
    table: String,
}

impl DynamoPolicyRepo {
    /// Builds the repo.
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl PolicyRepo for DynamoPolicyRepo {
    async fn latest(&self, org_id: &str) -> Result<Option<PolicyArtifact>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s("POLICY#LATEST"))
            .send()
            .await
            .map_err(backend)?;
        let Some(item) = out.item() else {
            return Ok(None);
        };
        let version = item
            .get("version")
            .and_then(|v| v.as_n().ok())
            .and_then(|x| x.parse::<u32>().ok())
            .ok_or_else(|| backend("policy item missing version"))?;
        let bundle = item
            .get("bundle_json")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .ok_or_else(|| backend("policy item missing bundle_json"))?;
        Ok(Some(PolicyArtifact {
            version,
            bytes: bundle.into_bytes(),
        }))
    }
}

#[async_trait]
impl PolicyAdminRepository for DynamoPolicyRepo {
    async fn list_policies(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<PolicySummary>, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :org and begins_with(SK, :prefix)")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .expression_attribute_values(":prefix", s("POLICY#v"))
            .send()
            .await
            .map_err(backend)?;
        let mut items: Vec<_> = out.items().iter().map(policy_summary_from_item).collect();
        items.sort_by_key(|p| Reverse(p.version));
        let total = items.len() as u64;
        let page = page.max(1);
        let per_page = per_page.max(1);
        let start = ((page - 1) * per_page) as usize;
        let end = usize::min(start + per_page as usize, items.len());
        Ok(Page {
            items: if start >= items.len() {
                vec![]
            } else {
                items[start..end].to_vec()
            },
            total,
            page,
            per_page,
            next_token: if end < items.len() {
                Some(format!("{page}:{per_page}"))
            } else {
                None
            },
        })
    }

    async fn get_policy(
        &self,
        org_id: &str,
        version: u32,
    ) -> Result<Option<PolicyDetail>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("POLICY#v{version}")))
            .send()
            .await
            .map_err(backend)?;
        Ok(out.item().map(|item| PolicyDetail {
            summary: policy_summary_from_item(item),
            bundle_json: parse_s(item, "bundle_json"),
            previous_version: parse_n(item, "previous_version"),
        }))
    }

    async fn create_policy(
        &self,
        org_id: &str,
        bundle_json: String,
    ) -> Result<PolicyDetail, StoreError> {
        let version = 1u32;
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s(format!("POLICY#v{version}")))
            .item("version", n(version))
            .item("status", s("draft"))
            .item("bundle_json", s(bundle_json.clone()))
            .item("previous_version", n(0))
            .item("published_at_ms", n(now_secs() * 1000))
            .condition_expression("attribute_not_exists(PK)")
            .send()
            .await
            .map_err(backend)?;
        Ok(PolicyDetail {
            summary: PolicySummary {
                version,
                status: "draft".into(),
                published_at_ms: Some(now_secs() * 1000),
                policy_id: version.to_string(),
                name: format!("Policy v{version}"),
                default_action: "warn".into(),
                rule_count: 0,
                created_at_ms: Some(now_secs() * 1000),
            },
            bundle_json,
            previous_version: None,
        })
    }

    async fn update_policy(
        &self,
        org_id: &str,
        version: u32,
        _expected_version: u32,
        bundle_json: String,
    ) -> Result<PolicyDetail, StoreError> {
        self.client
            .update_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("POLICY#v{version}")))
            .update_expression("SET bundle_json = :b")
            .expression_attribute_values(":b", s(bundle_json.clone()))
            .send()
            .await
            .map_err(backend)?;
        Ok(PolicyDetail {
            summary: PolicySummary {
                version,
                status: "draft".into(),
                published_at_ms: Some(now_secs() * 1000),
                policy_id: version.to_string(),
                name: format!("Policy v{version}"),
                default_action: "warn".into(),
                rule_count: 0,
                created_at_ms: Some(now_secs() * 1000),
            },
            bundle_json,
            previous_version: None,
        })
    }

    async fn delete_policy(&self, org_id: &str, version: u32) -> Result<bool, StoreError> {
        self.client
            .delete_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("POLICY#v{version}")))
            .send()
            .await
            .map_err(backend)?;
        Ok(true)
    }

    async fn list_policy_versions(
        &self,
        org_id: &str,
        _version: u32,
        page: u64,
        per_page: u64,
    ) -> Result<Page<PolicySummary>, StoreError> {
        self.list_policies(org_id, page, per_page).await
    }

    async fn publish_policy(
        &self,
        org_id: &str,
        version: u32,
        expected_version: u32,
    ) -> Result<PolicyDetail, StoreError> {
        let detail = self
            .get_policy(org_id, version)
            .await?
            .ok_or_else(|| backend("policy not found"))?;
        if detail.summary.version != expected_version {
            return Err(backend("version conflict"));
        }
        self.client
            .update_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s("POLICY#LATEST"))
            .update_expression("SET version = :v")
            .expression_attribute_values(":v", n(version))
            .send()
            .await
            .map_err(backend)?;
        Ok(detail)
    }
}

pub struct DynamoExceptions {
    client: Client,
    table: String,
}

impl DynamoExceptions {
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl ExceptionAdminRepository for DynamoExceptions {
    async fn list_exceptions(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<ExceptionSummary>, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :org and begins_with(SK, :prefix)")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .expression_attribute_values(":prefix", s("EXCEPTION#"))
            .send()
            .await
            .map_err(backend)?;
        let mut items: Vec<_> = out
            .items()
            .iter()
            .map(exception_summary_from_item)
            .collect();
        items.sort_by_key(|e| Reverse(e.requested_at_ms));
        let total = items.len() as u64;
        let page = page.max(1);
        let per_page = per_page.max(1);
        let start = ((page - 1) * per_page) as usize;
        let end = usize::min(start + per_page as usize, items.len());
        Ok(Page {
            items: if start >= items.len() {
                vec![]
            } else {
                items[start..end].to_vec()
            },
            total,
            page,
            per_page,
            next_token: None,
        })
    }

    async fn get_exception(
        &self,
        org_id: &str,
        exception_id: &str,
    ) -> Result<Option<ExceptionDetail>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("EXCEPTION#{exception_id}")))
            .send()
            .await
            .map_err(backend)?;
        Ok(out.item().map(|item| ExceptionDetail {
            summary: exception_summary_from_item(item),
            reason: parse_s(item, "reason"),
            requested_by: parse_s(item, "requested_by"),
            history: vec![],
        }))
    }
    async fn create_exception(
        &self,
        org_id: &str,
        rule_id: String,
        reason: String,
        requested_by: String,
    ) -> Result<ExceptionDetail, StoreError> {
        let exception_id = format!("exc-{}", now_secs());
        let requested_at_ms = now_secs() * 1000;
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s(format!("EXCEPTION#{exception_id}")))
            .item("exception_id", s(exception_id.clone()))
            .item("rule_id", s(rule_id.clone()))
            .item("status", s("pending"))
            .item("requested_at_ms", n(requested_at_ms))
            .item("reason", s(reason.clone()))
            .item("requested_by", s(requested_by.clone()))
            .send()
            .await
            .map_err(backend)?;
        Ok(ExceptionDetail {
            summary: ExceptionSummary {
                exception_id,
                rule_id,
                status: "pending".into(),
                requested_at_ms,
            },
            reason,
            requested_by,
            history: vec![],
        })
    }
    async fn update_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        status: String,
    ) -> Result<Option<ExceptionDetail>, StoreError> {
        self.client
            .update_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("EXCEPTION#{exception_id}")))
            .update_expression("SET #s = :s")
            .expression_attribute_names("#s", "status")
            .expression_attribute_values(":s", s(status))
            .send()
            .await
            .map_err(backend)?;
        self.get_exception(org_id, exception_id).await
    }
    async fn approve_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        _actor: String,
    ) -> Result<Option<ExceptionDetail>, StoreError> {
        self.update_exception(org_id, exception_id, "approved".into())
            .await
    }
    async fn reject_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        _actor: String,
    ) -> Result<Option<ExceptionDetail>, StoreError> {
        self.update_exception(org_id, exception_id, "rejected".into())
            .await
    }
    async fn history(
        &self,
        org_id: &str,
        exception_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<String>, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :org and begins_with(SK, :prefix)")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .expression_attribute_values(":prefix", s(format!("EXCEPTION#{exception_id}#H#")))
            .send()
            .await
            .map_err(backend)?;
        let items: Vec<_> = out.items().iter().map(|_| "history".to_string()).collect();
        Ok(Page {
            items,
            total: 0,
            page,
            per_page,
            next_token: None,
        })
    }
}

// ── Device directory ─────────────────────────────────────────────────────────

/// Device records in the core table (`ORG#<org>` / `DEVICE#<id>`).
pub struct DynamoDevices {
    client: Client,
    table: String,
}

impl DynamoDevices {
    /// Builds the directory.
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl DeviceDirectory for DynamoDevices {
    async fn upsert(&self, record: &DeviceRecord) -> Result<bool, StoreError> {
        let mut put = self
            .client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{}", record.org_id)))
            .item("SK", s(format!("DEVICE#{}", record.device_id)))
            .item("GSI1PK", s(format!("DEVICE#{}", record.device_id)))
            .item("GSI1SK", s("DEVICE"))
            // GSI3 is what `list_devices` queries — without these keys a
            // registered device would never appear in the dashboard.
            .item("GSI3PK", s(format!("ORG#{}", record.org_id)))
            .item(
                "GSI3SK",
                s(format!(
                    "DEVICE#{}#{}",
                    record.registered_at_ms, record.device_id
                )),
            )
            .item("device_id", s(record.device_id.clone()))
            .item("org_id", s(record.org_id.clone()))
            .item("hostname", s(record.hostname.clone()))
            .item("platform", s(record.platform.clone()))
            .item("agent_version", s(record.agent_version.clone()))
            .item("status", s("active"))
            .item("registered_at_ms", n(record.registered_at_ms))
            .item("last_seen_ms", n(record.registered_at_ms))
            .item("enrolled_by", s("self-enrollment"))
            .item("chain_count", n(0));
        for (attr, value) in [
            ("model", &record.model),
            ("os_version", &record.os_version),
            ("last_user", &record.last_user),
            ("ip_address", &record.ip_address),
            ("hostname_full", &record.hostname_full),
        ] {
            if let Some(v) = value {
                put = put.item(attr, s(v.clone()));
            }
        }
        put.send().await.map_err(backend)?;
        Ok(true)
    }
}

#[async_trait]
impl DeviceInventoryStore for DynamoDevices {
    async fn put_inventory(
        &self,
        org_id: &str,
        inventory: &DeviceInventory,
    ) -> Result<(), StoreError> {
        let payload = serde_json::to_string(inventory)
            .map_err(|e| backend(format!("inventory serialize: {e}")))?;
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s(format!("INVENTORY#{}", inventory.device_id)))
            .item("device_id", s(inventory.device_id.clone()))
            .item("org_id", s(org_id.to_string()))
            .item("collected_at_ms", n(inventory.collected_at_ms))
            .item("payload", s(payload))
            .send()
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn get_inventory(
        &self,
        org_id: &str,
        device_id: &str,
    ) -> Result<Option<DeviceInventory>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("INVENTORY#{device_id}")))
            .send()
            .await
            .map_err(backend)?;
        Ok(out
            .item()
            .and_then(|item| item.get("payload"))
            .and_then(|v| v.as_s().ok())
            .and_then(|raw| serde_json::from_str(raw).ok()))
    }
}

#[async_trait]
impl DeviceAdminRepository for DynamoDevices {
    async fn list_devices(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<DeviceSummary>, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .index_name("GSI3")
            .key_condition_expression("GSI3PK = :org")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .scan_index_forward(false)
            .send()
            .await
            .map_err(backend)?;

        let items = out.items();
        let mut devices: Vec<DeviceSummary> = items
            .iter()
            .filter_map(|item| {
                let sk = parse_s(item, "SK");
                if !sk.starts_with("DEVICE#") {
                    return None;
                }
                Some(DeviceSummary {
                    device_id: parse_s(item, "device_id"),
                    hostname: parse_s(item, "hostname"),
                    platform: parse_s(item, "platform"),
                    agent_version: parse_s(item, "agent_version"),
                    status: parse_s(item, "status"),
                    last_seen_ms: parse_n(item, "last_seen_ms"),
                    model: parse_s_opt(item, "model"),
                    os_version: parse_s_opt(item, "os_version"),
                    last_user: parse_s_opt(item, "last_user"),
                    ip_address: parse_s_opt(item, "ip_address"),
                })
            })
            .collect();
        let total = devices.len() as u64;
        let start = ((page.max(1) - 1) * per_page.max(1)) as usize;
        let end = usize::min(start + per_page.max(1) as usize, devices.len());
        let items = if start >= devices.len() {
            Vec::new()
        } else {
            devices.drain(start..end).collect()
        };
        Ok(Page {
            items,
            total,
            page: page.max(1),
            per_page: per_page.max(1),
            next_token: if end < total as usize {
                Some(format!("{}:{}", page.max(1) + 1, per_page.max(1)))
            } else {
                None
            },
        })
    }

    async fn get_device(
        &self,
        org_id: &str,
        device_id: &str,
    ) -> Result<Option<DeviceDetail>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("DEVICE#{device_id}")))
            .consistent_read(true)
            .send()
            .await
            .map_err(backend)?;
        let Some(item) = out.item() else {
            return Ok(None);
        };
        let summary = DeviceSummary {
            device_id: parse_s(item, "device_id"),
            hostname: parse_s(item, "hostname"),
            platform: parse_s(item, "platform"),
            agent_version: parse_s(item, "agent_version"),
            status: parse_s(item, "status"),
            last_seen_ms: parse_n(item, "last_seen_ms"),
            model: parse_s_opt(item, "model"),
            os_version: parse_s_opt(item, "os_version"),
            last_user: parse_s_opt(item, "last_user"),
            ip_address: parse_s_opt(item, "ip_address"),
        };
        Ok(Some(DeviceDetail {
            summary,
            hostname_full: parse_s(item, "hostname_full"),
            enrolled_by: parse_s(item, "enrolled_by"),
            chain_head: item.get("chain_head").and_then(|v| v.as_s().ok()).cloned(),
            chain_count: parse_n(item, "chain_count").unwrap_or(0),
        }))
    }

    async fn deactivate_device(&self, org_id: &str, device_id: &str) -> Result<bool, StoreError> {
        let out = self
            .client
            .update_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("DEVICE#{device_id}")))
            .update_expression("SET #status = :deactivated")
            .condition_expression("attribute_exists(PK)")
            .expression_attribute_names("#status", "status")
            .expression_attribute_values(":deactivated", s("deactivated"))
            .send()
            .await;
        match out {
            Ok(_) => Ok(true),
            Err(err) => {
                if err
                    .as_service_error()
                    .is_some_and(|e| e.is_conditional_check_failed_exception())
                {
                    return Ok(false);
                }
                Err(backend(format!("update_item: {err}")))
            }
        }
    }
}

#[async_trait]
impl DashboardAdminRepository for DynamoDevices {
    async fn get_stats(&self, org_id: &str) -> Result<DashboardStats, StoreError> {
        let devices = self
            .client
            .query()
            .table_name(&self.table)
            .index_name("GSI3")
            .key_condition_expression("GSI3PK = :org")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .send()
            .await
            .map_err(backend)?;
        let device_items = devices.items();
        let total_devices = device_items
            .iter()
            .filter(|i| parse_s(i, "SK").starts_with("DEVICE#"))
            .count() as u64;
        let active_devices = device_items
            .iter()
            .filter(|i| parse_s(i, "SK").starts_with("DEVICE#") && parse_s(i, "status") == "active")
            .count() as u64;

        let policies = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :org and begins_with(SK, :prefix)")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .expression_attribute_values(":prefix", s("POLICY#v"))
            .send()
            .await
            .map_err(backend)?;
        let policies_active = policies
            .items()
            .iter()
            .filter(|i| parse_s(i, "status") == "active")
            .count() as u64;

        let current_ms = now_secs() * 1000;
        let shard = yyyy_mm_from_ms(current_ms);
        let audit = self
            .client
            .query()
            .table_name(&self.table)
            .index_name("GSI1")
            .key_condition_expression("GSI1PK = :org")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}#{shard}")))
            .send()
            .await
            .map_err(backend)?;
        let events_24h = audit.items().len() as u64;
        let violations_24h = audit
            .items()
            .iter()
            .filter(|i| matches!(parse_s(i, "decision").as_str(), "Block" | "block"))
            .count() as u64;

        // Warn/block counts per category over the same shard window the other
        // event counters use. Events without a stored category are skipped.
        let mut by_category: Vec<CategoryCount> = Vec::new();
        for item in audit.items() {
            let decision = parse_s(item, "decision");
            let (warn, block) = match decision.as_str() {
                "Warn" | "warn" => (1, 0),
                "Block" | "block" => (0, 1),
                _ => continue,
            };
            let category = parse_s(item, "category");
            if category.is_empty() {
                continue;
            }
            match by_category.iter_mut().find(|c| c.category == category) {
                Some(entry) => {
                    entry.warn += warn;
                    entry.block += block;
                }
                None => by_category.push(CategoryCount {
                    category,
                    warn,
                    block,
                }),
            }
        }
        by_category.sort_by_key(|c| Reverse(c.warn + c.block));

        Ok(DashboardStats {
            total_devices,
            active_devices,
            violations_24h,
            events_24h,
            policies_active,
            pending_exceptions: 0,
            violations_by_category: by_category,
        })
    }
}

#[async_trait]
impl AuditAdminRepository for DynamoDevices {
    async fn search_audit(
        &self,
        org_id: &str,
        query: AuditSearchQuery,
    ) -> Result<Page<AuditEventSummary>, StoreError> {
        let mut rows = Vec::new();
        for shard in yyyymm_range(query.date_from_ms, query.date_to_ms) {
            let mut q = self
                .client
                .query()
                .table_name(&self.table)
                .index_name("GSI1")
                .key_condition_expression("GSI1PK = :org")
                .expression_attribute_values(":org", s(format!("ORG#{org_id}#{shard}")))
                .scan_index_forward(false);
            // Collect filters and AND them together: setting `filter_expression`
            // twice on the builder would replace the prior clause.
            let mut filters: Vec<&str> = Vec::new();
            if let Some(d) = &query.decision {
                filters.push("#decision = :decision");
                q = q.expression_attribute_names("#decision", "decision");
                q = q.expression_attribute_values(":decision", s(d.clone()));
            }
            if let Some(r) = &query.risk_level {
                filters.push("#risk = :risk");
                q = q.expression_attribute_names("#risk", "risk_level");
                q = q.expression_attribute_values(":risk", s(r.clone()));
            }
            if let Some(u) = &query.user_id {
                filters.push("#user = :user");
                q = q.expression_attribute_names("#user", "user_id");
                q = q.expression_attribute_values(":user", s(u.clone()));
            }
            if let Some(c) = &query.category {
                filters.push("#category = :category");
                q = q.expression_attribute_names("#category", "category");
                q = q.expression_attribute_values(":category", s(c.clone()));
            }
            if let Some(d) = &query.device_id {
                filters.push("#device = :device");
                q = q.expression_attribute_names("#device", "device_id");
                q = q.expression_attribute_values(":device", s(d.clone()));
            }
            if let Some(text) = &query.search {
                filters.push("(contains(#reason, :search) or contains(#device_attr, :search))");
                q = q.expression_attribute_names("#reason", "reason");
                q = q.expression_attribute_names("#device_attr", "device_id");
                q = q.expression_attribute_values(":search", s(text.clone()));
            }
            if !filters.is_empty() {
                q = q.filter_expression(filters.join(" and "));
            }
            let out = q.send().await.map_err(backend)?;
            rows.extend(out.items().iter().map(audit_summary_from_item));
        }
        rows.sort_by_key(|r| Reverse(r.timestamp_ms));
        let total = rows.len() as u64;
        let page = query.page.max(1);
        let per_page = query.per_page.max(1);
        let start = ((page - 1) * per_page) as usize;
        let end = usize::min(start + per_page as usize, rows.len());
        let items = if start >= rows.len() {
            Vec::new()
        } else {
            rows[start..end].to_vec()
        };
        Ok(Page {
            items,
            total,
            page,
            per_page,
            next_token: if end < rows.len() {
                Some(format!("{page}:{per_page}"))
            } else {
                None
            },
        })
    }

    async fn get_audit_event(
        &self,
        org_id: &str,
        event_id: &str,
    ) -> Result<Option<AuditEventDetail>, StoreError> {
        for shard in recent_months(36) {
            let out = self
                .client
                .query()
                .table_name(&self.table)
                .index_name("GSI1")
                .key_condition_expression("GSI1PK = :org")
                .expression_attribute_values(":org", s(format!("ORG#{org_id}#{shard}")))
                .send()
                .await
                .map_err(backend)?;
            for item in out.items() {
                if parse_s(item, "event_id") == event_id {
                    return Ok(audit_detail_from_item(item));
                }
            }
        }
        Ok(None)
    }

    async fn verify_chain_segment(
        &self,
        org_id: &str,
        device_id: &str,
        _start_event_id: Option<&str>,
        offset: u64,
        max_events: u64,
    ) -> Result<ChainSegment, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :pk")
            .expression_attribute_values(":pk", s(format!("DEVICE#{device_id}")))
            .scan_index_forward(false)
            .limit((max_events + offset) as i32)
            .send()
            .await
            .map_err(backend)?;
        let events: Vec<AuditEventDetail> = out
            .items()
            .iter()
            .filter(|i| parse_s(i, "org_id") == org_id)
            .filter_map(audit_detail_from_item)
            .collect();
        let start = offset as usize;
        let end = usize::min(start + max_events as usize, events.len());
        let items = if start >= events.len() {
            Vec::new()
        } else {
            events[start..end].to_vec()
        };
        Ok(ChainSegment {
            events: items,
            next_offset: if end < events.len() {
                Some(end as u64)
            } else {
                None
            },
            complete: end >= events.len(),
        })
    }
}

// ── Users + settings ─────────────────────────────────────────────────────────

fn user_summary_from_item(item: &HashMap<String, AttributeValue>) -> UserSummary {
    UserSummary {
        id: parse_s(item, "user_id"),
        email: parse_s(item, "email"),
        role: parse_s(item, "role"),
        status: parse_s(item, "status"),
        last_login_ms: parse_n(item, "last_login_ms"),
    }
}

fn default_settings(org_id: &str) -> OrgSettings {
    OrgSettings {
        org_id: org_id.to_string(),
        org_name: org_id.to_string(),
        default_policy_id: "default".into(),
        enrollment_mode: "invite".into(),
        data_retention_days: 90,
        email_alerts: true,
        slack_webhook_url: None,
    }
}

fn settings_from_item(org_id: &str, item: &HashMap<String, AttributeValue>) -> OrgSettings {
    OrgSettings {
        org_id: org_id.to_string(),
        org_name: parse_s(item, "org_name"),
        default_policy_id: parse_s(item, "default_policy_id"),
        enrollment_mode: parse_s(item, "enrollment_mode"),
        data_retention_days: parse_n::<u32>(item, "data_retention_days").unwrap_or(90),
        email_alerts: item
            .get("email_alerts")
            .and_then(|v| v.as_bool().ok())
            .copied()
            .unwrap_or(true),
        slack_webhook_url: item
            .get("slack_webhook_url")
            .and_then(|v| v.as_s().ok())
            .filter(|s| !s.is_empty())
            .cloned(),
    }
}

/// Dashboard users in the core table (`ORG#<org>` / `USER#<id>`).
pub struct DynamoUsers {
    client: Client,
    table: String,
}

impl DynamoUsers {
    /// Builds the repo.
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl UserAdminRepository for DynamoUsers {
    async fn list_users(
        &self,
        org_id: &str,
        query: UserListQuery,
    ) -> Result<Page<UserSummary>, StoreError> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .key_condition_expression("PK = :org and begins_with(SK, :prefix)")
            .expression_attribute_values(":org", s(format!("ORG#{org_id}")))
            .expression_attribute_values(":prefix", s("USER#"))
            .send()
            .await
            .map_err(backend)?;
        let mut items: Vec<UserSummary> = out.items().iter().map(user_summary_from_item).collect();
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
        items.sort_by(|a, b| a.email.cmp(&b.email));
        let total = items.len() as u64;
        let page = query.page.max(1);
        let per_page = query.per_page.max(1);
        let start = ((page - 1) * per_page) as usize;
        let end = usize::min(start + per_page as usize, items.len());
        Ok(Page {
            items: if start >= items.len() {
                vec![]
            } else {
                items[start..end].to_vec()
            },
            total,
            page,
            per_page,
            next_token: if end < items.len() {
                Some(format!("{page}:{per_page}"))
            } else {
                None
            },
        })
    }

    async fn get_user(
        &self,
        org_id: &str,
        user_id: &str,
    ) -> Result<Option<UserSummary>, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("USER#{user_id}")))
            .send()
            .await
            .map_err(backend)?;
        Ok(out.item().map(user_summary_from_item))
    }

    async fn put_user(&self, org_id: &str, user: &UserSummary) -> Result<(), StoreError> {
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s(format!("USER#{}", user.id)))
            .item("GSI1PK", s(format!("EMAIL#{}", user.email)))
            .item("GSI1SK", s(format!("ORG#{org_id}")))
            .item("user_id", s(user.id.clone()))
            .item("email", s(user.email.clone()))
            .item("role", s(user.role.clone()))
            .item("status", s(user.status.clone()))
            .item("last_login_ms", n(user.last_login_ms.unwrap_or(0)))
            .send()
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn mark_disabled(&self, org_id: &str, user_id: &str) -> Result<bool, StoreError> {
        let out = self
            .client
            .update_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s(format!("USER#{user_id}")))
            .update_expression("SET #s = :disabled")
            .expression_attribute_names("#s", "status")
            .expression_attribute_values(":disabled", s("disabled"))
            .condition_expression("attribute_exists(PK)")
            .send()
            .await;
        match out {
            Ok(_) => Ok(true),
            Err(err) if err.to_string().contains("ConditionalCheckFailed") => Ok(false),
            Err(err) => Err(backend(err)),
        }
    }
}

/// Org settings in the core table (`ORG#<org>` / `SETTINGS`).
pub struct DynamoSettings {
    client: Client,
    table: String,
}

impl DynamoSettings {
    /// Builds the repo.
    pub fn new(client: Client, table: impl Into<String>) -> Self {
        Self {
            client,
            table: table.into(),
        }
    }
}

#[async_trait]
impl SettingsAdminRepository for DynamoSettings {
    async fn get_settings(&self, org_id: &str) -> Result<OrgSettings, StoreError> {
        let out = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("PK", s(format!("ORG#{org_id}")))
            .key("SK", s("SETTINGS"))
            .send()
            .await
            .map_err(backend)?;
        Ok(out
            .item()
            .map(|item| settings_from_item(org_id, item))
            .unwrap_or_else(|| default_settings(org_id)))
    }

    async fn update_settings(
        &self,
        org_id: &str,
        patch: SettingsUpdateRequest,
        actor: &str,
    ) -> Result<OrgSettings, StoreError> {
        let current = self.get_settings(org_id).await?;
        let audit_changes = serde_json::to_string(&patch).unwrap_or_default();
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
        let now_ms = now_secs() * 1000;
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s("SETTINGS"))
            .item("org_name", s(updated.org_name.clone()))
            .item("default_policy_id", s(updated.default_policy_id.clone()))
            .item("enrollment_mode", s(updated.enrollment_mode.clone()))
            .item("data_retention_days", n(updated.data_retention_days))
            .item("email_alerts", AttributeValue::Bool(updated.email_alerts))
            .item(
                "slack_webhook_url",
                s(updated.slack_webhook_url.clone().unwrap_or_default()),
            )
            .item("updated_at_ms", n(now_ms))
            .item("updated_by", s(actor))
            .send()
            .await
            .map_err(backend)?;
        self.client
            .put_item()
            .table_name(&self.table)
            .item("PK", s(format!("ORG#{org_id}")))
            .item("SK", s(format!("SETTINGS_AUDIT#{now_ms}")))
            .item("updated_at_ms", n(now_ms))
            .item("updated_by", s(actor))
            .item("changes", s(audit_changes))
            .send()
            .await
            .map_err(backend)?;
        Ok(updated)
    }
}
