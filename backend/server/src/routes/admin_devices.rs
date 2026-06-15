//! `/admin/devices` — list, get, and deactivate devices, plus per-device
//! process/extension inventory and event timeline (org-scoped).

use app::{handle_admin_device_delete, handle_admin_device_get, handle_admin_device_list};
use app::{AdminPageQuery, DeviceInventory, DeviceInventoryStore as _, DeviceSummary};
use aws_adapters::DynamoDevices;
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::auth::require_admin_mw;
use crate::error::ApiErrorResponse;
use crate::request_ctx::AdminRequestContext;
use crate::routes::admin_audit;
use crate::state::AppState;

pub fn router(state: AppState) -> Router<AppState> {
    // axum 0.7 path-param syntax is `/:id` ({id} braces are 0.8-only and
    // silently never match).
    Router::new()
        .route("/admin/devices", get(list))
        .route("/admin/devices/:id", get(get_one).delete(delete_one))
        .route("/admin/devices/:id/inventory", get(get_inventory))
        .route("/admin/devices/:id/events", get(get_events))
        .route_layer(middleware::from_fn_with_state(state, require_admin_mw))
}

#[derive(Debug, Deserialize)]
struct PageArgs {
    page: Option<u64>,
    per_page: Option<u64>,
    search: Option<String>,
    status: Option<String>,
}

/// Case-insensitive match across the device's display fields.
fn device_matches(d: &DeviceSummary, needle: &str) -> bool {
    let needle = needle.to_lowercase();
    [
        Some(d.device_id.as_str()),
        Some(d.hostname.as_str()),
        Some(d.platform.as_str()),
        d.last_user.as_deref(),
        d.ip_address.as_deref(),
        d.model.as_deref(),
        d.os_version.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|field| field.to_lowercase().contains(&needle))
}

async fn list(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Query(q): Query<PageArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 100);
    let filtered = q.search.as_deref().map(str::trim).is_some_and(|s| !s.is_empty())
        || q.status.as_deref().is_some_and(|s| !s.is_empty());
    if !filtered {
        let query = AdminPageQuery { page, per_page };
        return match handle_admin_device_list(&repo, &ctx.org_id, query).await {
            Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
            Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
        };
    }
    // Search/status filter: the repo paginates in memory anyway, so fetch one
    // large page, filter here, then re-paginate.
    let query = AdminPageQuery { page: 1, per_page: 100 };
    match handle_admin_device_list(&repo, &ctx.org_id, query).await {
        Ok(resp) => {
            let mut items: Vec<DeviceSummary> = resp.items;
            if let Some(status) = q.status.as_deref().filter(|s| !s.is_empty()) {
                items.retain(|d| d.status == status);
            }
            if let Some(needle) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                items.retain(|d| device_matches(d, needle));
            }
            let total = items.len() as u64;
            let start = ((page - 1) * per_page) as usize;
            let end = usize::min(start + per_page as usize, items.len());
            let page_items: Vec<DeviceSummary> = if start >= items.len() {
                Vec::new()
            } else {
                items[start..end].to_vec()
            };
            (
                StatusCode::OK,
                Json(app::Page {
                    items: page_items,
                    total,
                    page,
                    per_page,
                    next_token: None,
                }),
            )
                .into_response()
        }
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

/// GET `/admin/devices/:id/inventory` — latest process/extension snapshot
/// reported by the device agent (empty snapshot when none reported yet).
async fn get_inventory(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<String>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );
    match repo.get_inventory(&ctx.org_id, &id).await {
        Ok(Some(inv)) => (StatusCode::OK, Json(inv)).into_response(),
        Ok(None) => (
            StatusCode::OK,
            Json(DeviceInventory {
                device_id: id,
                ..DeviceInventory::default()
            }),
        )
            .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

/// GET `/admin/devices/:id/events` — the device's audit-event timeline
/// (prompt scans and decisions attributed to this device).
async fn get_events(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<String>,
    Query(q): Query<PageArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let args = admin_audit::ListArgs {
        page: q.page,
        per_page: q.per_page,
        device_id: Some(id.clone()),
        search: q.search.clone(),
        ..admin_audit::ListArgs::default()
    };
    // Dev mode: serve from the in-memory scan store (same source as
    // /admin/audit). Events are recorded under the device's org, which can
    // differ from the dashboard's dev-claims org — match by device only.
    if std::env::var("VG_DEV_CLAIMS").is_ok() {
        return (
            StatusCode::OK,
            Json(admin_audit::dev_audit_page(&args, None, false)),
        )
            .into_response();
    }
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.audit_table.clone(),
    );
    match app::handle_admin_audit_list(&repo, &ctx.org_id, args.into()).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn get_one(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<String>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );
    match handle_admin_device_get(&repo, &ctx.org_id, &id).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn delete_one(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<String>,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );
    match handle_admin_device_delete(&repo, &ctx.org_id, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}