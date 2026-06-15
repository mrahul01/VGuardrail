//! `POST /events/batch` — idempotent, tamper-evident audit ingestion.

use std::sync::Arc;

use app::handle_events_batch;
use aws_adapters::{DynamoAuditStore, DynamoIdempotency, S3Archive};
use functions::{
    body_bytes, error_response, header_value, init_tracing, json_response, request_context, AppCtx,
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
    let rc = match request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    let upload_id = header_value(&req, "idempotency-key");
    let body = body_bytes(&req);

    let store = DynamoAuditStore::new(
        ctx.clients.dynamodb.clone(),
        ctx.config.audit_table.clone(),
        rc.org_id.clone(),
    );
    let archive = S3Archive::new(ctx.clients.s3.clone(), ctx.config.audit_bucket.clone());
    let idem = DynamoIdempotency::new(ctx.clients.dynamodb.clone(), ctx.config.audit_table.clone());

    match handle_events_batch(&store, &archive, &idem, &rc, upload_id.as_deref(), &body).await {
        Ok(resp) => Ok(json_response(200, &resp)),
        Err(e) => Ok(error_response(&e, None)),
    }
}
