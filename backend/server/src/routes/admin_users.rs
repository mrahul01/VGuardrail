//! `/admin/users` — list, invite, and disable dashboard users.

use app::{
    handle_admin_user_create, handle_admin_user_delete, handle_admin_user_list,
    UserCreateRequest, UserListQuery,
};
use aws_adapters::{CognitoUserAdmin, DynamoUsers};
use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use serde::Deserialize;

use crate::auth::require_admin_mw;
use crate::error::ApiErrorResponse;
use crate::request_ctx::AdminRequestContext;
use crate::state::AppState;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/admin/users", get(list_users).post(invite_user))
        // axum 0.7 path-param syntax (braces are 0.8-only and never match).
        .route("/admin/users/:id", delete(disable_user))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin_mw))
}

#[derive(Debug, Deserialize, Default)]
struct ListArgs {
    page: Option<u64>,
    per_page: Option<u64>,
    role: Option<String>,
    status: Option<String>,
    search: Option<String>,
}

impl From<ListArgs> for UserListQuery {
    fn from(a: ListArgs) -> Self {
        Self {
            page: a.page.unwrap_or(1).max(1),
            per_page: a.per_page.unwrap_or(25).clamp(1, 100),
            role: a.role,
            status: a.status,
            search: a.search,
        }
    }
}

fn users_repo(state: &AppState) -> DynamoUsers {
    DynamoUsers::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    )
}

fn identity(state: &AppState) -> CognitoUserAdmin {
    CognitoUserAdmin::new(
        state.cognito().clone(),
        state.resource.user_pool_id.clone(),
    )
}

async fn list_users(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Query(q): Query<ListArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }
    match handle_admin_user_list(&users_repo(&state), &ctx.org_id, q.into()).await {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn invite_user(
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
    let body: UserCreateRequest = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(_) => {
            return ApiErrorResponse::from_api(
                &audit_core::ApiError::BadRequest("invalid body".into()),
                None,
            )
            .into_response();
        }
    };
    match handle_admin_user_create(
        &users_repo(&state),
        &identity(&state),
        &ctx.org_id,
        &ctx.role,
        body,
    )
    .await
    {
        Ok(u) => (StatusCode::CREATED, Json(u)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn disable_user(
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
    match handle_admin_user_delete(
        &users_repo(&state),
        &identity(&state),
        &ctx.org_id,
        &id,
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}