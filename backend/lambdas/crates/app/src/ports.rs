//! Dependency-inversion ports: the storage and identity traits the handlers
//! depend on. AWS adapters implement them in production; in-memory fakes
//! (`crate::testing`) implement them for tests and the native e2e harness.

use async_trait::async_trait;
use audit_core::AuditEvent;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Authenticated request context derived from the JWT claims.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestContext {
    /// The calling device.
    pub device_id: String,
    /// The device's organization.
    pub org_id: String,
}

/// The head of a device's audit hash chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainHead {
    /// `event_hash` of the most recent event.
    pub hash: String,
    /// `event_id` of the most recent event.
    pub event_id: String,
    /// Number of events in the chain.
    pub count: u64,
}

/// Outcome of an atomic chained append.
#[derive(Debug, PartialEq, Eq)]
pub enum AppendOutcome {
    /// The event was stored and the chain advanced.
    Stored,
    /// The `event_id` already existed; nothing changed (idempotent).
    DuplicateEvent,
    /// The chain head moved under us (concurrent writer); caller should retry.
    ChainConflict,
}

/// A backend error from a port.
#[derive(Debug, Error)]
pub enum StoreError {
    /// Underlying backend failure.
    #[error("store backend error: {0}")]
    Backend(String),
}

/// Persists audit events and maintains the per-device hash chain.
#[async_trait]
pub trait AuditStore: Send + Sync {
    /// Returns the current chain head for a device, if any.
    async fn chain_head(&self, device_id: &str) -> Result<Option<ChainHead>, StoreError>;

    /// Atomically stores `event` (with its hash fields set) **iff** its
    /// `event_id` is absent **and** the device chain head equals `expected_head`,
    /// then advances the head to `new_head`.
    async fn append_if_head(
        &self,
        event: &AuditEvent,
        expected_head: Option<&str>,
        new_head: &ChainHead,
    ) -> Result<AppendOutcome, StoreError>;
}

/// Writes the immutable raw batch to the archive (S3).
#[async_trait]
pub trait ArchiveStore: Send + Sync {
    /// Stores the raw batch body write-once; returns the object key.
    async fn put_raw(
        &self,
        org_id: &str,
        device_id: &str,
        upload_id: &str,
        body: &[u8],
    ) -> Result<String, StoreError>;
}

/// The cached result of a processed upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadRecord {
    /// Events stored or already present.
    pub accepted: u32,
    /// Events that failed validation or could not be chained.
    pub rejected: u32,
}

/// Tracks processed `upload_id`s so retries replay the original result.
#[async_trait]
pub trait IdempotencyStore: Send + Sync {
    /// Returns the recorded result for `upload_id`, if it was already processed.
    async fn get(&self, upload_id: &str) -> Result<Option<UploadRecord>, StoreError>;
    /// Records the result of processing `upload_id` (with a TTL in production).
    async fn put(
        &self,
        upload_id: &str,
        device_id: &str,
        record: &UploadRecord,
    ) -> Result<(), StoreError>;
}

/// A stored, signed policy bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyArtifact {
    /// Bundle version.
    pub version: u32,
    /// Raw signed bundle bytes.
    pub bytes: Vec<u8>,
}

/// Reads the latest signed policy bundle for an org.
#[async_trait]
pub trait PolicyRepo: Send + Sync {
    /// Returns the latest bundle for `org_id`, if one is published.
    async fn latest(&self, org_id: &str) -> Result<Option<PolicyArtifact>, StoreError>;
}

/// Resolves an org from an enrollment secret (registration gate).
#[async_trait]
pub trait EnrollmentVerifier: Send + Sync {
    /// Returns the org id the enrollment token authorizes, or `None` if invalid.
    async fn resolve_org(&self, token: &str) -> Result<Option<String>, StoreError>;
}

/// A device's persisted record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceRecord {
    /// Stable device id.
    pub device_id: String,
    /// Owning org.
    pub org_id: String,
    /// Hostname.
    pub hostname: String,
    /// Platform.
    pub platform: String,
    /// Agent version.
    pub agent_version: String,
    /// Registration time (Unix millis).
    pub registered_at_ms: i64,
    /// Hardware model, e.g. `MacBookPro18,3` (when the connector can read it).
    pub model: Option<String>,
    /// OS version string, e.g. `macOS 15.5 (24F74)`.
    pub os_version: Option<String>,
    /// OS user logged in at registration time.
    pub last_user: Option<String>,
    /// Client IP observed at registration (server-derived, never client-claimed
    /// unless behind a trusted proxy).
    pub ip_address: Option<String>,
    /// Fully-qualified hostname, when distinct from the display hostname.
    pub hostname_full: Option<String>,
}

/// Persists device records (idempotent on device_id).
#[async_trait]
pub trait DeviceDirectory: Send + Sync {
    /// Upserts a device record; returns true if newly created.
    async fn upsert(&self, record: &DeviceRecord) -> Result<bool, StoreError>;
}

/// Issued device credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tokens {
    /// Short-lived access token (JWT).
    pub access_token: String,
    /// Long-lived refresh token.
    pub refresh_token: String,
    /// Access-token lifetime in seconds.
    pub expires_in: i64,
}

/// Creates the device's identity (Cognito user) and issues tokens.
#[async_trait]
pub trait DeviceIdentityIssuer: Send + Sync {
    /// Ensures a Cognito user for the device and returns fresh tokens.
    async fn ensure_user_and_issue(
        &self,
        device_id: &str,
        org_id: &str,
    ) -> Result<Tokens, StoreError>;
}

/// Per-category warn/block counts for the dashboard stats endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategoryCount {
    /// Category wire name (snake_case, e.g. `company_confidential`).
    pub category: String,
    /// Events with a `warn` decision in the window.
    pub warn: u64,
    /// Events with a `block` decision in the window.
    pub block: u64,
}

/// Summary view used by the dashboard stats endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DashboardStats {
    /// Total devices in the org.
    pub total_devices: u64,
    /// Active devices in the org.
    pub active_devices: u64,
    /// Violations in the last 24 hours.
    pub violations_24h: u64,
    /// Total audit events in the last 24 hours.
    pub events_24h: u64,
    /// Active policies.
    pub policies_active: u64,
    /// Pending exceptions.
    pub pending_exceptions: u64,
    /// Warn/block counts per policy category over the stats window.
    #[serde(default)]
    pub violations_by_category: Vec<CategoryCount>,
}

/// Device summary used in dashboard tables. Carries the at-a-glance facts
/// (user, model, OS, IP) so the device table needs no per-row detail fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceSummary {
    /// Device id.
    pub device_id: String,
    /// Hostname.
    pub hostname: String,
    /// Platform.
    pub platform: String,
    /// Agent version.
    pub agent_version: String,
    /// Device status.
    pub status: String,
    /// Last seen time in unix millis.
    pub last_seen_ms: Option<i64>,
    /// Hardware model, e.g. `MacBookPro18,3`.
    #[serde(default)]
    pub model: Option<String>,
    /// OS version string.
    #[serde(default)]
    pub os_version: Option<String>,
    /// OS user observed at registration.
    #[serde(default)]
    pub last_user: Option<String>,
    /// Client IP observed by the server at registration.
    #[serde(default)]
    pub ip_address: Option<String>,
}

/// Device detail payload for the dashboard. The quick facts (user/model/OS/IP)
/// live on the flattened [`DeviceSummary`]; this adds enrollment + chain data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceDetail {
    /// Device summary fields.
    #[serde(flatten)]
    pub summary: DeviceSummary,
    /// Hostname with FQDN.
    pub hostname_full: String,
    /// Who enrolled the device.
    pub enrolled_by: String,
    /// Chain head hash.
    pub chain_head: Option<String>,
    /// Chain length.
    pub chain_count: u64,
}

/// One running process/app reported by the agent inventory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceProcess {
    /// Process id.
    pub pid: u32,
    /// Process or app name.
    pub name: String,
    /// OS user owning the process.
    #[serde(default)]
    pub user: Option<String>,
    /// Process start timestamp.
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    /// True when this is a GUI application (vs background process).
    #[serde(default)]
    pub is_app: bool,
    /// Full command line (agent-capped length; absent when unreadable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// AI classification (ai_ide / ai_cli / ai_desktop / browser).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_category: Option<String>,
    /// "running" | "installed" (absent = running, for old agents).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// One installed browser extension reported by the agent inventory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrowserExtension {
    /// Browser the extension belongs to (chrome/edge/brave/firefox/safari).
    pub browser: String,
    /// Store/extension id when known.
    #[serde(default)]
    pub extension_id: Option<String>,
    /// Extension display name.
    pub name: String,
    /// Extension version.
    #[serde(default)]
    pub version: Option<String>,
}

/// Point-in-time process/extension inventory for one device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DeviceInventory {
    /// Device id.
    #[serde(default)]
    pub device_id: String,
    /// When the agent collected this snapshot.
    #[serde(default)]
    pub collected_at_ms: i64,
    /// Running processes/apps (capped by the agent).
    #[serde(default)]
    pub processes: Vec<DeviceProcess>,
    /// Installed browser extensions.
    #[serde(default)]
    pub extensions: Vec<BrowserExtension>,
}

/// Storage for device inventory snapshots (latest snapshot wins).
#[async_trait]
pub trait DeviceInventoryStore: Send + Sync {
    /// Upserts the latest inventory snapshot for a device.
    async fn put_inventory(
        &self,
        org_id: &str,
        inventory: &DeviceInventory,
    ) -> Result<(), StoreError>;

    /// Loads the latest inventory snapshot for a device.
    async fn get_inventory(
        &self,
        org_id: &str,
        device_id: &str,
    ) -> Result<Option<DeviceInventory>, StoreError>;
}

/// Page envelope used by admin list endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page<T> {
    /// Returned items.
    pub items: Vec<T>,
    /// Total matching items.
    pub total: u64,
    /// Requested page.
    pub page: u64,
    /// Requested page size.
    pub per_page: u64,
    /// Opaque next token.
    pub next_token: Option<String>,
}

/// Audit search filters and pagination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditSearchQuery {
    /// Optional start timestamp.
    pub date_from_ms: Option<i64>,
    /// Optional end timestamp.
    pub date_to_ms: Option<i64>,
    /// Optional decision filter.
    pub decision: Option<String>,
    /// Optional risk level filter.
    pub risk_level: Option<String>,
    /// Optional user filter.
    pub user_id: Option<String>,
    /// Optional category filter (snake_case wire name).
    pub category: Option<String>,
    /// Optional device filter (per-device event timelines).
    #[serde(default)]
    pub device_id: Option<String>,
    /// Optional free-text search over the event reason.
    #[serde(default)]
    pub search: Option<String>,
    /// Requested page.
    pub page: u64,
    /// Requested page size.
    pub per_page: u64,
}

/// Summary view for audit/violation list endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEventSummary {
    /// Event id.
    pub event_id: String,
    /// Device id.
    pub device_id: String,
    /// Event timestamp.
    pub timestamp_ms: i64,
    /// Decision string.
    pub decision: String,
    /// Risk level string.
    pub risk_level: String,
    /// Event type string.
    pub event_type: String,
    /// Provider.
    pub provider: Option<String>,
    /// Category wire name (engine-provided, or derived from the
    /// highest-severity finding when the event carries none).
    pub category: Option<String>,
    /// Human-readable decision explanation.
    pub reason: Option<String>,
}

/// Audit detail payload, with viewer-safe redaction applied when needed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEventDetail {
    /// Full event payload.
    #[serde(flatten)]
    pub event: AuditEvent,
}

/// Bounded chain verification result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChainSegment {
    /// Verified events, newest first.
    pub events: Vec<AuditEventDetail>,
    /// Next offset for pagination.
    pub next_offset: Option<u64>,
    /// Whether the chain was fully exhausted.
    pub complete: bool,
}

/// Policy bundle summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicySummary {
    /// Version number.
    pub version: u32,
    /// Status.
    pub status: String,
    /// Published timestamp.
    pub published_at_ms: Option<i64>,
    /// Stable policy identifier (defaults to the version when absent).
    #[serde(default)]
    pub policy_id: String,
    /// Human-readable policy name.
    #[serde(default)]
    pub name: String,
    /// Default action when no rule matches (allow/warn/block).
    #[serde(default)]
    pub default_action: String,
    /// Number of rules in the bundle.
    #[serde(default)]
    pub rule_count: u32,
    /// Creation timestamp.
    #[serde(default)]
    pub created_at_ms: Option<i64>,
}

/// Policy detail payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDetail {
    /// Summary fields.
    #[serde(flatten)]
    pub summary: PolicySummary,
    /// Raw bundle.
    pub bundle_json: String,
    /// Previous version pointer.
    pub previous_version: Option<u32>,
}

/// Policy publish request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyPublishRequest {
    /// Expected current version.
    pub expected_version: u32,
}

/// Exception summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExceptionSummary {
    /// Exception id.
    pub exception_id: String,
    /// Rule id.
    pub rule_id: String,
    /// Status.
    pub status: String,
    /// Requested timestamp.
    pub requested_at_ms: i64,
}

/// Exception detail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExceptionDetail {
    /// Summary fields.
    #[serde(flatten)]
    pub summary: ExceptionSummary,
    /// Reason.
    pub reason: String,
    /// Requested by.
    pub requested_by: String,
    /// Approval history.
    pub history: Vec<String>,
}

/// Admin repository for dashboard statistics.
#[async_trait]
pub trait DashboardAdminRepository: Send + Sync {
    /// Loads the org-scoped dashboard stats.
    async fn get_stats(&self, org_id: &str) -> Result<DashboardStats, StoreError>;
}

/// Admin repository for device inventory.
#[async_trait]
pub trait DeviceAdminRepository: Send + Sync {
    /// Lists devices within the org.
    async fn list_devices(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<DeviceSummary>, StoreError>;

    /// Gets the device detail.
    async fn get_device(
        &self,
        org_id: &str,
        device_id: &str,
    ) -> Result<Option<DeviceDetail>, StoreError>;

    /// Deactivates a device.
    async fn deactivate_device(&self, org_id: &str, device_id: &str) -> Result<bool, StoreError>;
}

/// Admin repository for audit and violation search.
#[async_trait]
pub trait AuditAdminRepository: Send + Sync {
    /// Searches org-scoped audit events.
    async fn search_audit(
        &self,
        org_id: &str,
        query: AuditSearchQuery,
    ) -> Result<Page<AuditEventSummary>, StoreError>;

    /// Gets a specific audit event.
    async fn get_audit_event(
        &self,
        org_id: &str,
        event_id: &str,
    ) -> Result<Option<AuditEventDetail>, StoreError>;

    /// Verifies a bounded segment of the device chain.
    async fn verify_chain_segment(
        &self,
        org_id: &str,
        device_id: &str,
        start_event_id: Option<&str>,
        offset: u64,
        max_events: u64,
    ) -> Result<ChainSegment, StoreError>;
}

/// Admin repository for policies.
#[async_trait]
pub trait PolicyAdminRepository: Send + Sync {
    /// Lists policies.
    async fn list_policies(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<PolicySummary>, StoreError>;
    /// Gets a policy.
    async fn get_policy(
        &self,
        org_id: &str,
        version: u32,
    ) -> Result<Option<PolicyDetail>, StoreError>;
    /// Creates a policy draft.
    async fn create_policy(
        &self,
        org_id: &str,
        bundle_json: String,
    ) -> Result<PolicyDetail, StoreError>;
    /// Updates a policy draft.
    async fn update_policy(
        &self,
        org_id: &str,
        version: u32,
        expected_version: u32,
        bundle_json: String,
    ) -> Result<PolicyDetail, StoreError>;
    /// Deletes a draft.
    async fn delete_policy(&self, org_id: &str, version: u32) -> Result<bool, StoreError>;
    /// Lists policy versions.
    async fn list_policy_versions(
        &self,
        org_id: &str,
        version: u32,
        page: u64,
        per_page: u64,
    ) -> Result<Page<PolicySummary>, StoreError>;
    /// Publishes a policy.
    async fn publish_policy(
        &self,
        org_id: &str,
        version: u32,
        expected_version: u32,
    ) -> Result<PolicyDetail, StoreError>;
}

/// Admin repository for exceptions.
#[async_trait]
pub trait ExceptionAdminRepository: Send + Sync {
    /// Lists exceptions.
    async fn list_exceptions(
        &self,
        org_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<ExceptionSummary>, StoreError>;
    /// Gets an exception.
    async fn get_exception(
        &self,
        org_id: &str,
        exception_id: &str,
    ) -> Result<Option<ExceptionDetail>, StoreError>;
    /// Creates an exception.
    async fn create_exception(
        &self,
        org_id: &str,
        rule_id: String,
        reason: String,
        requested_by: String,
    ) -> Result<ExceptionDetail, StoreError>;
    /// Updates an exception.
    async fn update_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        status: String,
    ) -> Result<Option<ExceptionDetail>, StoreError>;
    /// Approves an exception.
    async fn approve_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        actor: String,
    ) -> Result<Option<ExceptionDetail>, StoreError>;
    /// Rejects an exception.
    async fn reject_exception(
        &self,
        org_id: &str,
        exception_id: &str,
        actor: String,
    ) -> Result<Option<ExceptionDetail>, StoreError>;
    /// Lists exception history.
    async fn history(
        &self,
        org_id: &str,
        exception_id: &str,
        page: u64,
        per_page: u64,
    ) -> Result<Page<String>, StoreError>;
}

/// Dashboard user summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserSummary {
    /// Stable user id (Cognito sub).
    pub id: String,
    /// Email address.
    pub email: String,
    /// RBAC role.
    pub role: String,
    /// `active`, `invited`, or `disabled`.
    pub status: String,
    /// Last login timestamp.
    pub last_login_ms: Option<i64>,
}

/// User invite/create request.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct UserCreateRequest {
    /// Target email.
    pub email: String,
    /// Target role.
    pub role: String,
}

/// User list filters and pagination.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct UserListQuery {
    /// Page number.
    pub page: u64,
    /// Page size.
    pub per_page: u64,
    /// Optional role filter.
    pub role: Option<String>,
    /// Optional status filter.
    pub status: Option<String>,
    /// Optional email search.
    pub search: Option<String>,
}

/// Org settings payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrgSettings {
    /// Org id.
    pub org_id: String,
    /// Display name.
    pub org_name: String,
    /// Default policy id.
    pub default_policy_id: String,
    /// `open`, `invite`, or `closed`.
    pub enrollment_mode: String,
    /// Retention in days.
    pub data_retention_days: u32,
    /// Email alert toggle.
    pub email_alerts: bool,
    /// Optional Slack webhook.
    pub slack_webhook_url: Option<String>,
}

/// Partial settings update.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct SettingsUpdateRequest {
    /// Display name.
    pub org_name: Option<String>,
    /// Default policy id.
    pub default_policy_id: Option<String>,
    /// Enrollment mode.
    pub enrollment_mode: Option<String>,
    /// Retention in days.
    pub data_retention_days: Option<u32>,
    /// Email alert toggle.
    pub email_alerts: Option<bool>,
    /// Slack webhook.
    pub slack_webhook_url: Option<String>,
}

/// Admin repository for org users.
#[async_trait]
pub trait UserAdminRepository: Send + Sync {
    /// Lists users in the org.
    async fn list_users(
        &self,
        org_id: &str,
        query: UserListQuery,
    ) -> Result<Page<UserSummary>, StoreError>;

    /// Gets a user by id.
    async fn get_user(
        &self,
        org_id: &str,
        user_id: &str,
    ) -> Result<Option<UserSummary>, StoreError>;

    /// Persists a user record.
    async fn put_user(&self, org_id: &str, user: &UserSummary) -> Result<(), StoreError>;

    /// Marks a user disabled.
    async fn mark_disabled(&self, org_id: &str, user_id: &str) -> Result<bool, StoreError>;
}

/// Cognito admin operations for dashboard users.
#[async_trait]
pub trait UserIdentityAdmin: Send + Sync {
    /// Invites a user and returns the Cognito username/sub.
    async fn invite_user(
        &self,
        email: &str,
        org_id: &str,
        role: &str,
    ) -> Result<String, StoreError>;

    /// Disables/deletes the Cognito user.
    async fn delete_user(&self, user_id: &str) -> Result<(), StoreError>;
}

/// Admin repository for org settings.
#[async_trait]
pub trait SettingsAdminRepository: Send + Sync {
    /// Loads org settings (defaults when absent).
    async fn get_settings(&self, org_id: &str) -> Result<OrgSettings, StoreError>;

    /// Applies a partial update and records an audit trail entry.
    async fn update_settings(
        &self,
        org_id: &str,
        patch: SettingsUpdateRequest,
        actor: &str,
    ) -> Result<OrgSettings, StoreError>;
}
