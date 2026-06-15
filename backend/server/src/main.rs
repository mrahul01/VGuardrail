//! VGuardrail Audit Cloud — server binary entry point.
//!
//! Replaces the API Gateway + Lambda stack with a single native HTTP
//! service. See `DOCKER_MIGRATION_AUDIT.md` for the migration design.

use server::router;

#[tokio::main]
async fn main() {
    if let Err(e) = router::run().await {
        eprintln!("vguardrail-server: fatal: {e}");
        std::process::exit(1);
    }
}
