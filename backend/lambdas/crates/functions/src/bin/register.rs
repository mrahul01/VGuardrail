//! `POST /devices/register` — enrollment-gated device registration.

use std::sync::Arc;

use app::{handle_register, RegisterRequest};
use audit_core::ApiError;
use aws_adapters::{CognitoIdentity, DynamoDevices, SecretsEnrollment};
use functions::{
    body_bytes, error_response, header_value, init_tracing, json_response, now_ms, AppCtx,
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
    let token = header_value(&req, "x-enrollment-token");
    let body = body_bytes(&req);
    let dto: RegisterRequest = match serde_json::from_slice(&body) {
        Ok(d) => d,
        Err(e) => return Ok(error_response(&ApiError::BadRequest(e.to_string()), None)),
    };

    let enrollment = SecretsEnrollment::new(
        ctx.clients.secrets.clone(),
        ctx.config.enrollment_secret_prefix.clone(),
    );
    let devices = DynamoDevices::new(ctx.clients.dynamodb.clone(), ctx.config.core_table.clone());
    let identity = CognitoIdentity::new(
        ctx.clients.cognito.clone(),
        ctx.config.user_pool_id.clone(),
        ctx.config.app_client_id.clone(),
    );

    match handle_register(
        &enrollment,
        &devices,
        &identity,
        token.as_deref(),
        dto,
        now_ms(),
    )
    .await
    {
        Ok(resp) => Ok(json_response(200, &resp)),
        Err(e) => Ok(error_response(&e, None)),
    }
}
