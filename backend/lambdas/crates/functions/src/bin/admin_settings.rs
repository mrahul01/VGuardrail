//! `GET/PUT /admin/settings`.

use std::sync::Arc;

use app::{handle_admin_settings_get, handle_admin_settings_put, SettingsUpdateRequest};
use aws_adapters::DynamoSettings;
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

async fn handler(req: Request, ctx: Arc<AppCtx>) -> Result<Response<Body>, Error> {
    let rc = match admin_request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    if !matches!(rc.role.as_str(), "super_admin" | "org_admin") {
        return Ok(error_response(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        ));
    }
    let repo = DynamoSettings::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let path = req.uri().path();

    match req.method().as_str() {
        "GET" if path == "/admin/settings" => {
            match handle_admin_settings_get(&repo, &rc.org_id).await {
                Ok(settings) => Ok(json_response(200, &settings)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "PUT" if path == "/admin/settings" => {
            let body: SettingsUpdateRequest = match serde_json::from_slice(&body_bytes(&req)) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(error_response(
                        &audit_core::ApiError::BadRequest("invalid body".into()),
                        None,
                    ));
                }
            };
            match handle_admin_settings_put(&repo, &rc.org_id, &rc.role, body).await {
                Ok(settings) => Ok(json_response(200, &settings)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        _ => Ok(error_response(
            &audit_core::ApiError::BadRequest("unsupported method".into()),
            None,
        )),
    }
}
