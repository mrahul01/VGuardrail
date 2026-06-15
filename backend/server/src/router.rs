//! Axum router assembly + `tokio::main` entry.

use axum::Router;
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

use crate::routes;
use crate::state::AppState;

/// Build the full router with global layers applied.
/// Returns Router<()> for use with axum::serve.
pub fn build_router(state: AppState) -> Router {
    let body_limit = state.config.max_body_bytes;
    let request_timeout = state.config.request_timeout;

    // CORS: auth is header/bearer-based (never ambient cookies), so a
    // permissive policy leaks nothing — without it, Safari web extensions
    // cannot call the dev /scan endpoint at all (unlike Chromium, Safari
    // enforces a full CORS preflight on extension fetches, and the router
    // previously answered OPTIONS with 405).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    routes::build(state.clone())
        .layer(cors)
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(TraceLayer::new_for_http().make_span_with(
            |req: &axum::http::Request<axum::body::Body>| {
                tracing::info_span!("http", method = %req.method(), uri = %req.uri())
            },
        ))
        .layer(RequestBodyLimitLayer::new(body_limit))
        // Raise axum's own extractor limit (defaults to 2 MB) to match, so
        // `/scan` requests carrying base64 file attachments aren't rejected by
        // the Json extractor before the body-limit layer is consulted.
        .layer(axum::extract::DefaultBodyLimit::max(body_limit))
        .layer(TimeoutLayer::new(request_timeout))
        .with_state(state)
}

/// `tokio::main` server entry.
pub async fn run() -> Result<(), String> {
    init_tracing();

    let config = crate::config::ServerConfig::from_env()?;
    let bind = config.bind_addr.clone();
    let state = AppState::load(config).await?;

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .map_err(|e| format!("bind {bind}: {e}"))?;
    tracing::info!(%bind, "vguardrail-server listening");

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutdown signal received");
    };

    // connect-info exposes the peer address so device registration can record
    // the client IP even with no proxy in front.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .map_err(|e| format!("server: {e}"))?;
    Ok(())
}

/// Initialize JSON structured logging (idempotent).
pub fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let _ = tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().json().with_target(false))
        .try_init();
}