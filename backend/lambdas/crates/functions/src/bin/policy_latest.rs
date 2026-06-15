//! `GET /policies/latest` — serve the latest signed bundle (conditional GET).

use std::sync::Arc;

use app::{handle_policy_latest, PolicyOutcome};
use aws_adapters::DynamoPolicyRepo;
use functions::{error_response, header_value, init_tracing, request_context, AppCtx};
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
    let if_none_match = header_value(&req, "if-none-match");

    let repo = DynamoPolicyRepo::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    match handle_policy_latest(
        &repo,
        &rc.org_id,
        if_none_match.as_deref(),
        ctx.config.policy_pubkey_b64.as_deref(),
    )
    .await
    {
        Ok(PolicyOutcome::NotModified) => Ok(Response::builder()
            .status(304)
            .body(Body::Empty)
            .expect("response builds")),
        Ok(PolicyOutcome::Bundle { version, bytes }) => Ok(Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .header("etag", version.to_string())
            .body(Body::from(bytes))
            .expect("response builds")),
        Err(e) => Ok(error_response(&e, None)),
    }
}
