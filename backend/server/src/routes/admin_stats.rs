//! `GET /admin/stats` — org-scoped dashboard metrics.
//!
//! Auth is enforced via `require_admin_mw` which, when `VG_DEV_CLAIMS=1`,
//! reads `x-vg-role` and `x-vg-org-id` headers instead of verifying a
//! Cognito JWT.  In production mode it requires a valid RS256 JWT with
//! an admin role claim.
//!
//! See `auth.rs` verify() for the full dev-mode bypass logic.

use app::handle_admin_stats;
use aws_adapters::DynamoDevices;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};

use crate::auth::require_admin_mw;
use crate::error::ApiErrorResponse;
use crate::request_ctx::AdminRequestContext;
use crate::state::AppState;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/admin/stats", get(stats))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_admin_mw,
        ))
}

async fn stats(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }

    // In dev mode (VG_DEV_CLAIMS=1), return default stats to avoid failing
    // on local DynamoDB which may not have the required GSI indexes.
    if std::env::var("VG_DEV_CLAIMS").is_ok() {
        return (StatusCode::OK, Json(serde_json::json!({
            "total_devices": 0,
            "active_devices": 0,
            "violations_24h": 0,
            "events_24h": 0,
            "policies_active": 0,
            "pending_exceptions": 0,
            "violations_by_category": [],
        }))).into_response();
    }

    // Production: query real DynamoDB stats.
    let repo = DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );

    match handle_admin_stats(&repo, &ctx.org_id).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}