//! Admin policies and exceptions routes.

use std::sync::Arc;

use app::{ExceptionAdminRepository, PolicyAdminRepository, PolicyPublishRequest};
use aws_adapters::{DynamoExceptions, DynamoPolicyRepo};
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

fn parse_page_query(raw: &str) -> (u64, u64) {
    let mut page = 1u64;
    let mut per_page = 25u64;
    for part in raw.split('&').filter(|s| !s.is_empty()) {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or_default();
        let value = kv.next().unwrap_or_default();
        match key {
            "page" => page = value.parse().unwrap_or(1),
            "per_page" => per_page = value.parse().unwrap_or(25),
            _ => {}
        }
    }
    (page, per_page)
}

fn policy_id_from_path(path: &str) -> Option<u32> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["admin", "policies", id] => id.parse().ok(),
        ["admin", "policies", id, "versions"] => id.parse().ok(),
        ["admin", "policies", id, "publish"] => id.parse().ok(),
        _ => None,
    }
}

fn exception_id_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["admin", "exceptions", id] => Some((*id).to_string()),
        ["admin", "exceptions", id, "approve"] => Some((*id).to_string()),
        ["admin", "exceptions", id, "reject"] => Some((*id).to_string()),
        ["admin", "exceptions", id, "history"] => Some((*id).to_string()),
        _ => None,
    }
}

async fn handler(req: Request, ctx: Arc<AppCtx>) -> Result<Response<Body>, Error> {
    let rc = match admin_request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    let can_read = matches!(
        rc.role.as_str(),
        "super_admin" | "org_admin" | "auditor" | "viewer"
    );
    let can_write = matches!(rc.role.as_str(), "super_admin" | "org_admin");
    let policy_repo =
        DynamoPolicyRepo::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let exc_repo =
        DynamoExceptions::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let path = req.uri().path();
    let query = req.uri().query().unwrap_or("");
    let (page, per_page) = parse_page_query(query);

    match req.method().as_str() {
        "GET" if path == "/admin/policies" => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            match policy_repo.list_policies(&rc.org_id, page, per_page).await {
                Ok(page) => Ok(json_response(200, &page)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "GET" if path.ends_with("/versions") => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(version) = policy_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid policy path".into()),
                    None,
                ));
            };
            match policy_repo
                .list_policy_versions(&rc.org_id, version, page, per_page)
                .await
            {
                Ok(page) => Ok(json_response(200, &page)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "GET" if path.starts_with("/admin/policies/") => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(version) = policy_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid policy path".into()),
                    None,
                ));
            };
            match policy_repo.get_policy(&rc.org_id, version).await {
                Ok(Some(policy)) => Ok(json_response(200, &policy)),
                Ok(None) => Ok(error_response(
                    &audit_core::ApiError::NotFound("policy not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "POST" if path == "/admin/policies" => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            let bundle = body
                .get("bundle_json")
                .and_then(|v| v.as_str())
                .unwrap_or("{}")
                .to_string();
            match policy_repo.create_policy(&rc.org_id, bundle).await {
                Ok(policy) => Ok(json_response(201, &policy)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "PUT" if path.starts_with("/admin/policies/") => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(version) = policy_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid policy path".into()),
                    None,
                ));
            };
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            let bundle = body
                .get("bundle_json")
                .and_then(|v| v.as_str())
                .unwrap_or("{}")
                .to_string();
            let expected = body
                .get("expected_version")
                .and_then(|v| v.as_u64())
                .unwrap_or(version as u64) as u32;
            match policy_repo
                .update_policy(&rc.org_id, version, expected, bundle)
                .await
            {
                Ok(policy) => Ok(json_response(200, &policy)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "DELETE" if path.starts_with("/admin/policies/") => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(version) = policy_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid policy path".into()),
                    None,
                ));
            };
            match policy_repo.delete_policy(&rc.org_id, version).await {
                Ok(true) => Ok(Response::builder()
                    .status(204)
                    .body(Body::Empty)
                    .expect("response builds")),
                Ok(false) => Ok(error_response(
                    &audit_core::ApiError::NotFound("policy not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "POST" if path.ends_with("/publish") => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(version) = policy_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid policy path".into()),
                    None,
                ));
            };
            let body: PolicyPublishRequest = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => PolicyPublishRequest {
                    expected_version: version,
                },
            };
            match policy_repo
                .publish_policy(&rc.org_id, version, body.expected_version)
                .await
            {
                Ok(policy) => Ok(json_response(200, &policy)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "GET" if path == "/admin/exceptions" => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            match exc_repo.list_exceptions(&rc.org_id, page, per_page).await {
                Ok(page) => Ok(json_response(200, &page)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "GET" if path.ends_with("/history") => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(exception_id) = exception_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid exception path".into()),
                    None,
                ));
            };
            match exc_repo
                .history(&rc.org_id, &exception_id, page, per_page)
                .await
            {
                Ok(page) => Ok(json_response(200, &page)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "GET" if path.starts_with("/admin/exceptions/") => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(exception_id) = exception_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid exception path".into()),
                    None,
                ));
            };
            match exc_repo.get_exception(&rc.org_id, &exception_id).await {
                Ok(Some(exc)) => Ok(json_response(200, &exc)),
                Ok(None) => Ok(error_response(
                    &audit_core::ApiError::NotFound("exception not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "POST" if path == "/admin/exceptions" => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            let rule_id = body
                .get("rule_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let reason = body
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            match exc_repo
                .create_exception(&rc.org_id, rule_id, reason, rc.role.clone())
                .await
            {
                Ok(exc) => Ok(json_response(201, &exc)),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "PUT"
            if path.starts_with("/admin/exceptions/")
                && !path.ends_with("/approve")
                && !path.ends_with("/reject") =>
        {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(exception_id) = exception_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid exception path".into()),
                    None,
                ));
            };
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            let status = body
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending")
                .to_string();
            match exc_repo
                .update_exception(&rc.org_id, &exception_id, status)
                .await
            {
                Ok(Some(exc)) => Ok(json_response(200, &exc)),
                Ok(None) => Ok(error_response(
                    &audit_core::ApiError::NotFound("exception not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "POST" if path.ends_with("/approve") => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(exception_id) = exception_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid exception path".into()),
                    None,
                ));
            };
            match exc_repo
                .approve_exception(&rc.org_id, &exception_id, rc.role.clone())
                .await
            {
                Ok(Some(exc)) => Ok(json_response(200, &exc)),
                Ok(None) => Ok(error_response(
                    &audit_core::ApiError::NotFound("exception not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        "POST" if path.ends_with("/reject") => {
            if !can_write {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(exception_id) = exception_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid exception path".into()),
                    None,
                ));
            };
            match exc_repo
                .reject_exception(&rc.org_id, &exception_id, rc.role.clone())
                .await
            {
                Ok(Some(exc)) => Ok(json_response(200, &exc)),
                Ok(None) => Ok(error_response(
                    &audit_core::ApiError::NotFound("exception not found".into()),
                    None,
                )),
                Err(e) => Ok(error_response(
                    &audit_core::ApiError::Internal(e.to_string()),
                    None,
                )),
            }
        }
        _ => Ok(error_response(
            &audit_core::ApiError::BadRequest("unsupported".into()),
            None,
        )),
    }
}
