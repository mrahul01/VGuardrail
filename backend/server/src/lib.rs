//! # server
//!
//! VGuardrail Audit Cloud — native HTTP service that replaces API Gateway
//! + Lambda while **reusing the existing `app` crate business logic
//! unchanged**.
//!
//! The server is a thin transport layer. Every route is a 1:1 mapping to
//! a `app::handle_*` async function. All data plane calls still go through
//! the same `aws-adapters` ports as the Lambda functions did.
//!
//! Public surface:
//!
//! * [`config::ServerConfig`]        — environment-driven config.
//! * [`state::AppState`]             — shared AWS clients + config + JWKS.
//! * [`auth`]                        — Cognito RS256 JWT middleware (Phase 3).
//! * [`error::ApiErrorResponse`]     — wire error envelope (matches Lambda).
//! * [`router::build_router`]        — the full Axum router.
//! * [`router::run`]                 — `tokio::main` server entry.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod auth;
pub mod config;
pub mod error;
pub(crate) mod extract;
pub mod request_ctx;
pub mod router;
pub mod routes;
pub mod state;

#[cfg(test)]
mod tests_http;

pub use config::ServerConfig;
pub use error::{api_error_response, ApiErrorResponse};
pub use request_ctx::{AdminRequestContext, RequestContext};
pub use state::AppState;
