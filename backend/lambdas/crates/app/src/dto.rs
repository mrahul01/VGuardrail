//! Request/response payloads for the agent-facing endpoints.

use audit_core::AuditEvent;
use serde::{Deserialize, Serialize};

/// `GET /health` response.
#[derive(Debug, Clone, Serialize)]
pub struct Health {
    /// Always `"healthy"`.
    pub status: String,
    /// Build version.
    pub version: String,
    /// Server time (ISO-8601).
    pub time: String,
}

/// `POST /devices/register` request. The quick-facts fields are optional so
/// older agents keep registering; `ip_address` is never accepted from the
/// client — the server derives it from the connection.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterRequest {
    /// Stable device id.
    pub device_id: String,
    /// Hostname.
    pub hostname: String,
    /// Platform (`macos`).
    pub platform: String,
    /// Agent version.
    pub agent_version: String,
    /// Hardware model, e.g. `MacBookPro18,3`.
    #[serde(default)]
    pub model: Option<String>,
    /// OS version string, e.g. `macOS 15.5 (24F74)`.
    #[serde(default)]
    pub os_version: Option<String>,
    /// OS user logged in at registration.
    #[serde(default)]
    pub username: Option<String>,
    /// Fully-qualified hostname when it differs from `hostname`.
    #[serde(default)]
    pub hostname_full: Option<String>,
}

/// `POST /devices/register` response.
#[derive(Debug, Clone, Serialize)]
pub struct RegisterResponse {
    /// Always `"registered"`.
    pub status: String,
    /// The device's org.
    pub org_id: String,
    /// Access token (JWT).
    pub access_token: String,
    /// Refresh token.
    pub refresh_token: String,
    /// Access-token lifetime, seconds.
    pub expires_in: i64,
}

/// `POST /events/batch` request.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest {
    /// Optional client idempotency key.
    #[serde(default)]
    pub upload_id: Option<String>,
    /// The audit events.
    pub events: Vec<AuditEvent>,
}

/// `POST /events/batch` response.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BatchResponse {
    /// Events stored or already present.
    pub accepted: u32,
    /// Events rejected (validation/chain failure).
    pub rejected: u32,
    /// The effective upload id.
    pub upload_id: String,
    /// True if this upload was already processed and the result replayed.
    pub replayed: bool,
}
