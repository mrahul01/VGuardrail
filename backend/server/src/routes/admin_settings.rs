//! `/admin/settings` — org-scoped settings read/write.

use app::{handle_admin_settings_get, handle_admin_settings_put, SettingsUpdateRequest};
use aws_adapters::DynamoSettings;
use axum::{
    body::Bytes,
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
        .route("/admin/settings", get(get_settings).put(put_settings))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin_mw))
}

fn settings_repo(state: &AppState) -> DynamoSettings {
    DynamoSettings::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    )
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
) -> Response {
    if !matches!(ctx.role.as_str(), "super_admin" | "org_admin") {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    match handle_admin_settings_get(&settings_repo(&state), &ctx.org_id).await {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn put_settings(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    body: Bytes,
) -> Response {
    if !matches!(ctx.role.as_str(), "super_admin" | "org_admin") {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    let patch: SettingsUpdateRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    match handle_admin_settings_put(&settings_repo(&state), &ctx.org_id, &ctx.role, patch).await {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}