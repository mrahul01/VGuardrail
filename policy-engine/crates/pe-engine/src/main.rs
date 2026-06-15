//! `pe-engined` — the LaunchDaemon-managed Policy Engine server.
//!
//! Serves the gRPC `PolicyEngine` over a Unix domain socket. Configuration is
//! read from the environment so the LaunchDaemon plist supplies it:
//!
//! | Variable | Meaning | Default |
//! |----------|---------|---------|
//! | `VG_SOCKET_PATH` | UDS path | `/var/run/vguardrail/policy.sock` |
//! | `VG_STORE_PATH` | SQLite path | `/var/db/vguardrail/queue.db` |
//! | `VG_POLICY_PUBKEY` | base64 Ed25519 policy public key | (required) |
//! | `VG_EVENT_SIGNING_SEED` | base64 32-byte event signing seed | (required) |
//! | `VG_DEVICE_ID` | device id | stored / `unknown-device` |

use pe_engine::{build_runtime, runtime_params_from_env};
use pe_grpc::transport::bind_uds;
use pe_grpc::PolicyEngineServer;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = std::env::var("VG_SOCKET_PATH")
        .unwrap_or_else(|_| "/var/run/vguardrail/policy.sock".to_string());

    let params = runtime_params_from_env()?;
    let service = build_runtime(params)?;

    let incoming = bind_uds(&socket)?;
    eprintln!("vguardrail policy engine listening on {socket}");

    Server::builder()
        .add_service(PolicyEngineServer::new(service))
        .serve_with_incoming(incoming)
        .await?;

    Ok(())
}
