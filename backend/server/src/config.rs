//! Environment-driven server configuration.
//!
//! The server reads the same `VG_*` env vars that the Lambda binaries
//! used (see `aws_adapters::ResourceConfig::from_env`) plus a small
//! number of HTTP-server-specific additions:
//!
//! | Var                  | Required | Default | Description                              |
//! | -------------------- | -------- | ------- | ---------------------------------------- |
//! | `BIND_ADDR`          | ❌       | `0.0.0.0:8080` | TCP listener address.           |
//! | `VG_CORE_TABLE`      | ✅       | —       | Control-plane DynamoDB table.            |
//! | `VG_AUDIT_TABLE`     | ✅       | —       | Audit-event DynamoDB table.              |
//! | `VG_AUDIT_BUCKET`    | ✅       | —       | S3 bucket for the immutable audit archive.|
//! | `VG_USER_POOL_ID`    | ✅       | —       | Cognito User Pool id.                    |
//! | `VG_APP_CLIENT_ID`   | ✅       | —       | Cognito app client id (JWT audience).    |
//! | `VG_ENROLLMENT_PREFIX` | ❌    | `vguardrail/enrollment/` | Secrets Manager prefix.       |
//! | `VG_POLICY_PUBKEY`   | ❌       | —       | Optional base64 Ed25519 pubkey for served bundles. |
//! | `VG_DEV_CLAIMS`      | ❌       | `0`     | If `1`, accept `x-vg-device-id` / `x-vg-org-id` / `x-vg-role` headers (test only). |
//! | `VG_AWS_REGION`      | ❌       | SDK default | AWS region (overrides profile / IMDS). |
//! | `RUST_LOG`           | ❌       | `info`  | `tracing` filter.                        |
//! | `REQUEST_TIMEOUT_S`  | ❌       | `30`    | Per-request timeout (seconds).           |
//! | `MAX_BODY_BYTES`     | ❌       | `6291456` (6 MiB) | HTTP body size cap.         |

use std::time::Duration;

/// Server configuration. Constructed once at start-up.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// TCP bind address (`host:port`).
    pub bind_addr: String,
    /// Resource names + DynamoDB / S3 / Cognito / Secrets identifiers.
    pub resource: aws_adapters::ResourceConfig,
    /// Per-request timeout.
    pub request_timeout: Duration,
    /// HTTP body size cap (bytes).
    pub max_body_bytes: usize,
}

impl ServerConfig {
    /// Loads configuration from the environment.
    ///
    /// # Errors
    /// Returns the first missing required variable.
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            bind_addr: std::env::var("BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:8080".to_string()),
            resource: aws_adapters::ResourceConfig::from_env()?,
            request_timeout: Duration::from_secs(
                std::env::var("REQUEST_TIMEOUT_S")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(30),
            ),
            max_body_bytes: std::env::var("MAX_BODY_BYTES")
                .ok()
                .and_then(|s| s.parse().ok())
                // 16 MB: a 10 MB file attachment is ~13.3 MB once base64-encoded.
                .unwrap_or(16 * 1024 * 1024),
        })
    }
}
