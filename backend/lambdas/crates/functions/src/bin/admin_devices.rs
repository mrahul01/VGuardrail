//! `GET /admin/devices` and `GET/DELETE /admin/devices/{id}`.

use std::sync::Arc;

use app::{
    handle_admin_device_delete, handle_admin_device_get, handle_admin_device_list, AdminPageQuery,
};
use aws_adapters::DynamoDevices;
use functions::{admin_request_context, error_response, init_tracing, json_response, AppCtx};
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

fn device_id_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["admin", "devices", device_id] => Some((*device_id).to_string()),
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
    let can_delete = matches!(rc.role.as_str(), "super_admin" | "org_admin");
    let repo = DynamoDevices::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let path = req.uri().path();

    match req.method().as_str() {
        "GET" if path == "/admin/devices" => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let params = req.uri().query().unwrap_or("");
            let query = parse_query(params);
            match handle_admin_device_list(&repo, &rc.org_id, query).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "GET" => {
            if !can_read {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(device_id) = device_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid device path".into()),
                    None,
                ));
            };
            match handle_admin_device_get(&repo, &rc.org_id, &device_id).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "DELETE" => {
            if !can_delete {
                return Ok(error_response(
                    &audit_core::ApiError::Unauthorized("invalid role".into()),
                    None,
                ));
            }
            let Some(device_id) = device_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid device path".into()),
                    None,
                ));
            };
            match handle_admin_device_delete(&repo, &rc.org_id, &device_id).await {
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

fn parse_query(raw: &str) -> AdminPageQuery {
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
    AdminPageQuery { page, per_page }
}
