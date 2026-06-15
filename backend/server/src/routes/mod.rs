//! Route modules.
//!
//! Each module owns the Axum handlers for a logical group of routes
//! and re-exports the [`axum::Router`] builder that [`crate::router`]
//! stitches together.
//!
//! Auth is applied per-router via [`crate::auth::require_admin_jwt`] /
//! [`crate::auth::require_device_jwt`] / [`crate::auth::require_any_jwt`]
//! using [`axum::middleware::from_fn_with_state`].

pub mod admin_audit;
pub mod admin_devices;
pub mod admin_policies_exceptions;
pub mod admin_settings;
pub mod admin_stats;
pub mod admin_users;
pub mod agent;
pub mod scan;

use axum::Router;

use crate::state::AppState;

/// Build the full route tree (no global layers applied — those are added
/// in [`crate::router::build_router`]).
pub fn build(state: AppState) -> Router<AppState> {
    Router::new()
        .merge(agent::router(state.clone()))
        .merge(scan::router(state.clone()))
        .merge(admin_stats::router(state.clone()))
        .merge(admin_devices::router(state.clone()))
        .merge(admin_audit::router(state.clone()))
        .merge(admin_policies_exceptions::router(state.clone()))
        .merge(admin_users::router(state.clone()))
        .merge(admin_settings::router(state))
}
