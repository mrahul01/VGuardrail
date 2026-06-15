//! `/admin/policies` and `/admin/exceptions` — org-scoped policy CRUD
//! (with publish / version listing) and exception lifecycle.

use app::{ExceptionAdminRepository, PolicyAdminRepository, PolicyPublishRequest};
use aws_adapters::{DynamoExceptions, DynamoPolicyRepo};
use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::auth::require_admin_mw;
use crate::error::ApiErrorResponse;
use crate::request_ctx::AdminRequestContext;
use crate::state::AppState;

pub fn router(state: AppState) -> Router<AppState> {
    // axum 0.7 path-param syntax is `/:id` ({id} braces are 0.8-only and
    // silently never match).
    Router::new()
        // Policies
        .route("/admin/policies", get(list_policies).post(create_policy))
        .route("/admin/policies/:id", get(get_policy).put(put_policy))
        .route("/admin/policies/:id/versions", get(policy_versions))
        .route("/admin/policies/:id/publish", post(publish_policy))
        // Exceptions
        .route("/admin/exceptions", get(list_exceptions).post(create_exception))
        .route("/admin/exceptions/:id", get(get_exception).put(put_exception))
        .route("/admin/exceptions/:id/approve", post(approve_exception))
        .route("/admin/exceptions/:id/reject", post(reject_exception))
        .route("/admin/exceptions/:id/history", get(exception_history))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin_mw))
}

fn policy_repo(state: &AppState) -> DynamoPolicyRepo {
    DynamoPolicyRepo::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    )
}
fn exception_repo(state: &AppState) -> DynamoExceptions {
    DynamoExceptions::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    )
}

// ── Policies ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
struct PageArgs {
    page: Option<u64>,
    per_page: Option<u64>,
    search: Option<String>,
    status: Option<String>,
}

async fn list_policies(
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
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 100);
    let search = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let status = q.status.as_deref().filter(|s| !s.is_empty());
    if search.is_none() && status.is_none() {
        return match policy_repo(&state)
            .list_policies(&ctx.org_id, page, per_page)
            .await
        {
            Ok(p) => (StatusCode::OK, Json(p)).into_response(),
            Err(e) => ApiErrorResponse::from_api(
                &audit_core::ApiError::Internal(e.to_string()),
                None,
            )
            .into_response(),
        };
    }
    // Filtered list: the repo loads all org policies and paginates in memory,
    // so fetch one large page, filter on name/version/status, re-paginate.
    match policy_repo(&state)
        .list_policies(&ctx.org_id, 1, 100)
        .await
    {
        Ok(p) => {
            let mut items = p.items;
            if let Some(status) = status {
                items.retain(|p| p.status == status);
            }
            if let Some(needle) = search {
                let needle = needle.to_lowercase();
                items.retain(|p| {
                    p.name.to_lowercase().contains(&needle)
                        || format!("v{}", p.version).contains(&needle)
                        || p.policy_id.to_lowercase().contains(&needle)
                });
            }
            let total = items.len() as u64;
            let start = ((page - 1) * per_page) as usize;
            let end = usize::min(start + per_page as usize, items.len());
            let page_items = if start >= items.len() {
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
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct CreatePolicyBody {
    bundle_json: Option<String>,
}

async fn create_policy(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    body: Bytes,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let body: CreatePolicyBody = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    let bundle = body.bundle_json.unwrap_or_else(|| "{}".into());
    match policy_repo(&state).create_policy(&ctx.org_id, bundle).await {
        Ok(p) => (StatusCode::CREATED, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn get_policy(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<u32>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    match policy_repo(&state).get_policy(&ctx.org_id, id).await {
        Ok(Some(p)) => (StatusCode::OK, Json(p)).into_response(),
        Ok(None) => ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("policy not found".into()),
            None,
        )
        .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct UpdatePolicyBody {
    bundle_json: Option<String>,
    expected_version: Option<u32>,
}

async fn put_policy(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<u32>,
    body: Bytes,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let body: UpdatePolicyBody = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    let bundle = body.bundle_json.unwrap_or_else(|| "{}".into());
    let expected = body.expected_version.unwrap_or(id);
    match policy_repo(&state)
        .update_policy(&ctx.org_id, id, expected, bundle)
        .await
    {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn policy_versions(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<u32>,
    Query(q): Query<PageArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 100);
    match policy_repo(&state)
        .list_policy_versions(&ctx.org_id, id, page, per_page)
        .await
    {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn publish_policy(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<u32>,
    body: Bytes,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let body: PolicyPublishRequest = serde_json::from_slice(&body).unwrap_or(PolicyPublishRequest {
        expected_version: id,
    });
    match policy_repo(&state)
        .publish_policy(&ctx.org_id, id, body.expected_version)
        .await
    {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

// ── Exceptions ─────────────────────────────────────────────────────────────

async fn list_exceptions(
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
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 100);
    match exception_repo(&state)
        .list_exceptions(&ctx.org_id, page, per_page)
        .await
    {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct CreateExceptionBody {
    rule_id: Option<String>,
    reason: Option<String>,
}

async fn create_exception(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    body: Bytes,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let body: CreateExceptionBody = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    let rule_id = body.rule_id.unwrap_or_default();
    let reason = body.reason.unwrap_or_default();
    match exception_repo(&state)
        .create_exception(&ctx.org_id, rule_id, reason, ctx.role.clone())
        .await
    {
        Ok(p) => (StatusCode::CREATED, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn get_exception(
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
    match exception_repo(&state).get_exception(&ctx.org_id, &id).await {
        Ok(Some(e)) => (StatusCode::OK, Json(e)).into_response(),
        Ok(None) => ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("exception not found".into()),
            None,
        )
        .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct UpdateExceptionBody {
    status: Option<String>,
}

async fn put_exception(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !ctx.can_write() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let body: UpdateExceptionBody = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    let status = body.status.unwrap_or_else(|| "pending".into());
    match exception_repo(&state)
        .update_exception(&ctx.org_id, &id, status)
        .await
    {
        Ok(Some(e)) => (StatusCode::OK, Json(e)).into_response(),
        Ok(None) => ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("exception not found".into()),
            None,
        )
        .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn approve_exception(
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
    match exception_repo(&state)
        .approve_exception(&ctx.org_id, &id, ctx.role.clone())
        .await
    {
        Ok(Some(e)) => (StatusCode::OK, Json(e)).into_response(),
        Ok(None) => ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("exception not found".into()),
            None,
        )
        .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn reject_exception(
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
    match exception_repo(&state)
        .reject_exception(&ctx.org_id, &id, ctx.role.clone())
        .await
    {
        Ok(Some(e)) => (StatusCode::OK, Json(e)).into_response(),
        Ok(None) => ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("exception not found".into()),
            None,
        )
        .into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}

async fn exception_history(
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
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(25).clamp(1, 100);
    match exception_repo(&state)
        .history(&ctx.org_id, &id, page, per_page)
        .await
    {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(e.to_string()),
            None,
        )
        .into_response(),
    }
}