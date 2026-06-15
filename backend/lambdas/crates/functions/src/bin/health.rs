//! `GET /health` — liveness probe (no auth, no backend).

use functions::{init_tracing, json_response, now_iso};
use lambda_http::{run, service_fn, Body, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_tracing();
    run(service_fn(handler)).await
}

async fn handler(_req: Request) -> Result<Response<Body>, Error> {
    let health = app::handle_health(env!("CARGO_PKG_VERSION"), &now_iso());
    Ok(json_response(200, &health))
}
