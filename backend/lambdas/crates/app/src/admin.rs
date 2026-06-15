//! Dashboard admin handler logic.

use audit_core::ApiError;
use serde::{Deserialize, Serialize};

use crate::ports::{
    AuditAdminRepository, AuditEventDetail, AuditEventSummary, AuditSearchQuery, ChainSegment,
    DashboardAdminRepository, DashboardStats, DeviceAdminRepository, DeviceDetail, DeviceSummary,
    OrgSettings, Page, SettingsAdminRepository, SettingsUpdateRequest, StoreError,
    UserAdminRepository, UserCreateRequest, UserIdentityAdmin, UserListQuery, UserSummary,
};

fn backend(err: StoreError) -> ApiError {
    ApiError::Internal(err.to_string())
}

/// Pagination query for dashboard routes.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub struct PageQuery {
    /// Page number, 1-based.
    pub page: u64,
    /// Page size.
    pub per_page: u64,
}

/// Search query for audit routes.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SearchQuery {
    /// Page number.
    pub page: u64,
    /// Page size.
    pub per_page: u64,
    /// Optional start timestamp.
    pub date_from_ms: Option<i64>,
    /// Optional end timestamp.
    pub date_to_ms: Option<i64>,
    /// Optional decision filter.
    pub decision: Option<String>,
    /// Optional risk filter.
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
}

impl PageQuery {
    /// Clamps invalid values to safe defaults.
    #[must_use]
    pub fn normalize(self) -> Self {
        Self {
            page: self.page.max(1),
            per_page: self.per_page.clamp(1, 100),
        }
    }
}

impl SearchQuery {
    /// Clamps invalid values to safe defaults.
    #[must_use]
    pub fn normalize(self) -> Self {
        Self {
            page: self.page.max(1),
            per_page: self.per_page.clamp(1, 100),
            ..self
        }
    }
}

/// Loads org-scoped dashboard stats.
pub async fn handle_admin_stats(
    repo: &dyn DashboardAdminRepository,
    org_id: &str,
) -> Result<DashboardStats, ApiError> {
    repo.get_stats(org_id).await.map_err(backend)
}

/// Lists org-scoped devices.
pub async fn handle_admin_device_list(
    repo: &dyn DeviceAdminRepository,
    org_id: &str,
    query: PageQuery,
) -> Result<Page<DeviceSummary>, ApiError> {
    let query = query.normalize();
    repo.list_devices(org_id, query.page, query.per_page)
        .await
        .map_err(backend)
}

/// Gets a single device.
pub async fn handle_admin_device_get(
    repo: &dyn DeviceAdminRepository,
    org_id: &str,
    device_id: &str,
) -> Result<DeviceDetail, ApiError> {
    repo.get_device(org_id, device_id)
        .await
        .map_err(backend)?
        .ok_or_else(|| ApiError::NotFound("device not found".into()))
}

/// Deactivates a device.
pub async fn handle_admin_device_delete(
    repo: &dyn DeviceAdminRepository,
    org_id: &str,
    device_id: &str,
) -> Result<(), ApiError> {
    let deleted = repo
        .deactivate_device(org_id, device_id)
        .await
        .map_err(backend)?;
    if deleted {
        Ok(())
    } else {
        Err(ApiError::NotFound("device not found".into()))
    }
}

/// Lists audit events.
pub async fn handle_admin_audit_list(
    repo: &dyn AuditAdminRepository,
    org_id: &str,
    query: SearchQuery,
) -> Result<Page<AuditEventSummary>, ApiError> {
    let q = query.normalize();
    repo.search_audit(org_id, q.into()).await.map_err(backend)
}

/// Lists violations, which are the blocked audit events.
pub async fn handle_admin_audit_violation_list(
    repo: &dyn AuditAdminRepository,
    org_id: &str,
    query: SearchQuery,
) -> Result<Page<AuditEventSummary>, ApiError> {
    let q = query.normalize();
    handle_admin_audit_list(
        repo,
        org_id,
        SearchQuery {
            decision: Some("block".to_string()),
            ..q
        },
    )
    .await
}

/// Gets a single audit event.
pub async fn handle_admin_audit_detail(
    repo: &dyn AuditAdminRepository,
    org_id: &str,
    event_id: &str,
    viewer: bool,
) -> Result<AuditEventDetail, ApiError> {
    let mut detail = repo
        .get_audit_event(org_id, event_id)
        .await
        .map_err(backend)?
        .ok_or_else(|| ApiError::NotFound("audit event not found".into()))?;
    if viewer {
        detail.event.matched_rule_id = None;
        detail.event.findings.clear();
    }
    Ok(detail)
}

/// Verifies a bounded chain segment.
pub async fn handle_admin_audit_chain(
    repo: &dyn AuditAdminRepository,
    org_id: &str,
    device_id: &str,
    start_event_id: Option<&str>,
    offset: u64,
    max_events: u64,
) -> Result<ChainSegment, ApiError> {
    if max_events == 0 || max_events > 100 {
        return Err(ApiError::BadRequest("max_events out of bounds".into()));
    }
    repo.verify_chain_segment(org_id, device_id, start_event_id, offset, max_events)
        .await
        .map_err(backend)
}

impl From<SearchQuery> for AuditSearchQuery {
    fn from(query: SearchQuery) -> Self {
        Self {
            date_from_ms: query.date_from_ms,
            date_to_ms: query.date_to_ms,
            decision: query.decision,
            risk_level: query.risk_level,
            user_id: query.user_id,
            category: query.category,
            device_id: query.device_id,
            search: query.search,
            page: query.page,
            per_page: query.per_page,
        }
    }
}

impl UserListQuery {
    /// Clamps invalid values to safe defaults.
    #[must_use]
    pub fn normalize(self) -> Self {
        Self {
            page: self.page.max(1),
            per_page: self.per_page.clamp(1, 100),
            ..self
        }
    }
}

/// Returns whether `caller_role` may create a user with `target_role`.
#[must_use]
pub fn can_create_user(caller_role: &str, target_role: &str) -> bool {
    match caller_role {
        "super_admin" => matches!(
            target_role,
            "super_admin" | "org_admin" | "auditor" | "viewer"
        ),
        "org_admin" => matches!(target_role, "auditor" | "viewer"),
        _ => false,
    }
}

fn valid_user_role(role: &str) -> bool {
    matches!(role, "super_admin" | "org_admin" | "auditor" | "viewer")
}

fn valid_enrollment_mode(mode: &str) -> bool {
    matches!(mode, "open" | "invite" | "closed")
}

/// Lists org-scoped users.
pub async fn handle_admin_user_list(
    repo: &dyn UserAdminRepository,
    org_id: &str,
    query: UserListQuery,
) -> Result<Page<UserSummary>, ApiError> {
    repo.list_users(org_id, query.normalize())
        .await
        .map_err(backend)
}

/// Invites a user with role hierarchy enforcement.
pub async fn handle_admin_user_create(
    repo: &dyn UserAdminRepository,
    identity: &dyn UserIdentityAdmin,
    org_id: &str,
    caller_role: &str,
    request: UserCreateRequest,
) -> Result<UserSummary, ApiError> {
    let email = request.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    if !valid_user_role(&request.role) {
        return Err(ApiError::BadRequest("invalid role".into()));
    }
    if !can_create_user(caller_role, &request.role) {
        return Err(ApiError::Unauthorized(
            "cannot create user with this role".into(),
        ));
    }
    let user_id = identity
        .invite_user(&email, org_id, &request.role)
        .await
        .map_err(backend)?;
    let user = UserSummary {
        id: user_id,
        email,
        role: request.role,
        status: "invited".into(),
        last_login_ms: None,
    };
    repo.put_user(org_id, &user).await.map_err(backend)?;
    Ok(user)
}

/// Disables a user in Cognito and marks the record disabled.
pub async fn handle_admin_user_delete(
    repo: &dyn UserAdminRepository,
    identity: &dyn UserIdentityAdmin,
    org_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    let exists = repo
        .get_user(org_id, user_id)
        .await
        .map_err(backend)?
        .is_some();
    if !exists {
        return Err(ApiError::NotFound("user not found".into()));
    }
    identity.delete_user(user_id).await.map_err(backend)?;
    let updated = repo.mark_disabled(org_id, user_id).await.map_err(backend)?;
    if updated {
        Ok(())
    } else {
        Err(ApiError::NotFound("user not found".into()))
    }
}

/// Loads org settings.
pub async fn handle_admin_settings_get(
    repo: &dyn SettingsAdminRepository,
    org_id: &str,
) -> Result<OrgSettings, ApiError> {
    repo.get_settings(org_id).await.map_err(backend)
}

/// Updates org settings with validation and audit trail.
pub async fn handle_admin_settings_put(
    repo: &dyn SettingsAdminRepository,
    org_id: &str,
    actor: &str,
    patch: SettingsUpdateRequest,
) -> Result<OrgSettings, ApiError> {
    if let Some(ref mode) = patch.enrollment_mode {
        if !valid_enrollment_mode(mode) {
            return Err(ApiError::BadRequest("invalid enrollment_mode".into()));
        }
    }
    if let Some(days) = patch.data_retention_days {
        if !(7..=3650).contains(&days) {
            return Err(ApiError::BadRequest(
                "data_retention_days out of range".into(),
            ));
        }
    }
    if let Some(ref name) = patch.org_name {
        if name.trim().is_empty() {
            return Err(ApiError::BadRequest("org_name cannot be empty".into()));
        }
    }
    repo.update_settings(org_id, patch, actor)
        .await
        .map_err(backend)
}
