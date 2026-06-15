//! `GET /admin/stats` — org-scoped dashboard metrics.

use std::sync::Arc;

use app::handle_admin_stats;
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

async fn handler(req: Request, ctx: Arc<AppCtx>) -> Result<Response<Body>, Error> {
    let rc = match admin_request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    if !matches!(
        rc.role.as_str(),
        "super_admin" | "org_admin" | "auditor" | "viewer"
    ) {
        return Ok(error_response(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        ));
    }
    let repo = DynamoDevices::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    match handle_admin_stats(&repo, &rc.org_id).await {
        Ok(resp) => Ok(json_response(200, &resp)),
        Err(e) => Ok(error_response(&e, None)),
    }
}
