//! `GET/POST /admin/users` and `DELETE /admin/users/{id}`.

use std::sync::Arc;

use app::{
    handle_admin_user_create, handle_admin_user_delete, handle_admin_user_list, UserCreateRequest,
    UserListQuery,
};
use aws_adapters::{CognitoUserAdmin, DynamoUsers};
use functions::{
    admin_request_context, body_bytes, error_response, init_tracing, json_response, AppCtx,
};
use lambda_http::{run, service_fn, Body, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_tracing();
    let ctx = Arc::new(AppCtx::load().await.map_err(Error::from)?);
    run(service_fn(move |req| {
        let ctx = ctx.clone();
        async move { handler(req, ctx).await }
    }))
    .await
}

fn user_id_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["admin", "users", user_id] => Some((*user_id).to_string()),
        _ => None,
    }
}

async fn handler(req: Request, ctx: Arc<AppCtx>) -> Result<Response<Body>, Error> {
    let rc = match admin_request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    let can_read = matches!(rc.role.as_str(), "super_admin" | "org_admin");
    let can_write = matches!(rc.role.as_str(), "super_admin" | "org_admin");
    let repo = DynamoUsers::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let identity =
        CognitoUserAdmin::new(ctx.clients.cognito.clone(), ctx.config.user_pool_id.clone());
    let path = req.uri().path();

    match req.method().as_str() {
        "GET" if path == "/admin/users" => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let query = parse_query(req.uri().query().unwrap_or(""));
            match handle_admin_user_list(&repo, &rc.org_id, query).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "POST" if path == "/admin/users" => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let body: UserCreateRequest = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            match handle_admin_user_create(&repo, &identity, &rc.org_id, &rc.role, body).await {
                Ok(user) => Ok(json_response(201, &user)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "DELETE" => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(user_id) = user_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid user path".into()),
                    None,
                ));
            };
            match handle_admin_user_delete(&repo, &identity, &rc.org_id, &user_id).await {
                Ok(()) => Ok(Response::builder()
                    .status(204)
                    .body(Body::Empty)
                    .expect("response builds")),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        _ => Ok(error_response(
            &audit_core::ApiError::BadRequest("unsupported method".into()),
            None,
        )),
    }
}

fn parse_query(raw: &str) -> UserListQuery {
    let mut page = 1u64;
    let mut per_page = 25u64;
    let mut role = None;
    let mut status = None;
    let mut search = None;
    for part in raw.split('&').filter(|s| !s.is_empty()) {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or_default();
        let value = kv.next().unwrap_or_default();
        match key {
            "page" => page = value.parse().unwrap_or(1),
            "per_page" => per_page = value.parse().unwrap_or(25),
            "role" => role = Some(value.to_string()),
            "status" => status = Some(value.to_string()),
            "search" => search = Some(value.to_string()),
            _ => {}
        }
    }
    UserListQuery {
        page,
        per_page,
        role,
        status,
        search,
    }
}
