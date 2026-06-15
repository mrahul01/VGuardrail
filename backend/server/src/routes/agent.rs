//! Agent-facing routes: health, device registration, policy download, event batch.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::ApiErrorResponse,
    routes::admin_audit::{record_dev_audit, DevAuditEvent},
    AppState,
};

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/health", axum::routing::get(health))
        .route("/devices/register", axum::routing::post(register_device))
        .route("/devices/inventory", axum::routing::post(post_inventory))
        .route("/policies/latest", axum::routing::get(get_latest_policy))
        .route("/events/batch", axum::routing::post(post_events_batch))
        .with_state(state)
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

/// Health check endpoint (no auth required)
async fn health() -> impl IntoResponse {
    let body = serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION"),
        "time": chrono::Utc::now().timestamp_millis(),
    });
    (StatusCode::OK, Json(body))
}

/// Device registration – creates a device and returns a JWT.
/// In dev mode (VG_DEV_CLAIMS=1), it accepts any enrollment token (or none)
/// and returns a fake JWT.
async fn register_device(
    State(state): State<AppState>,
    connect_info: Option<axum::extract::ConnectInfo<std::net::SocketAddr>>,
    headers: HeaderMap,
    Json(req): Json<DeviceRegistrationRequest>,
) -> Result<impl IntoResponse, ApiErrorResponse> {
    let dev_mode = std::env::var("VG_DEV_CLAIMS").is_ok();

    if !dev_mode {
        // Production: require a valid enrollment token.
        let token = headers
            .get("x-enrollment-token")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                ApiErrorResponse::from_api(
                    &audit_core::ApiError::Unauthorized("missing enrollment token".into()),
                    None,
                )
            })?;

        let expected = std::env::var("VG_ENROLLMENT_TOKEN_SECRET")
            .or_else(|_| std::env::var("ENROLLMENT_TOKEN_SECRET"))
            .unwrap_or_default();

        if expected.is_empty() || token != expected {
            return Err(ApiErrorResponse::from_api(
                &audit_core::ApiError::Unauthorized("invalid enrollment token".into()),
                None,
            ));
        }
    }

    let org_id = if dev_mode {
        headers
            .get("x-vg-org-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("local-org")
            .to_string()
    } else {
        "org-default".to_string()
    };

    // Client IP: trust x-forwarded-for / x-real-ip when a proxy set them,
    // otherwise fall back to the socket peer address.
    let ip_address = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.trim().to_string())
        })
        .or_else(|| connect_info.map(|ci| ci.0.ip().to_string()));

    // Persist the device so it shows up in /admin/devices with its quick facts
    // (previously registration only minted a token and stored nothing).
    let record = app::DeviceRecord {
        device_id: req.device_id.clone(),
        org_id: org_id.clone(),
        hostname: req.hostname.clone(),
        platform: req.platform.clone(),
        agent_version: req.agent_version.clone(),
        registered_at_ms: chrono::Utc::now().timestamp_millis(),
        model: req.model.clone(),
        os_version: req.os_version.clone(),
        last_user: req.username.clone(),
        ip_address,
        hostname_full: req.hostname_full.clone(),
    };
    {
        use app::DeviceDirectory as _;
        let directory = aws_adapters::DynamoDevices::new(
            state.dynamodb().clone(),
            state.resource.core_table.clone(),
        );
        directory.upsert(&record).await.map_err(|e| {
            ApiErrorResponse::from_api(
                &audit_core::ApiError::Internal(format!("device upsert: {e}")),
                None,
            )
        })?;
    }

    // Fake JWT – no base64 required
    let fake_jwt = format!(
        "dev-jwt-{}-{}",
        req.device_id,
        chrono::Utc::now().timestamp()
    );

    let response = DeviceRegistrationResponse {
        status: "registered".to_string(),
        org_id,
        access_token: fake_jwt,
        refresh_token: None,
        expires_in: 3600,
    };

    Ok((StatusCode::OK, Json(response)))
}

/// Upload the device's process/extension inventory snapshot (latest wins).
/// The agent posts this after registration and on each refresh cycle so the
/// dashboard's device detail page can show running apps and extensions.
async fn post_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut inventory): Json<app::DeviceInventory>,
) -> Result<impl IntoResponse, ApiErrorResponse> {
    let dev_mode = std::env::var("VG_DEV_CLAIMS").is_ok();
    if !dev_mode {
        // Production would authenticate the device JWT here, like /events/batch.
        let _ = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                ApiErrorResponse::from_api(
                    &audit_core::ApiError::Unauthorized("missing device token".into()),
                    None,
                )
            })?;
    }
    let org_id = headers
        .get("x-vg-org-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("local-org")
        .to_string();
    // Never trust an empty device id — fall back to the header the connectors
    // already send on /scan.
    if inventory.device_id.is_empty() {
        inventory.device_id = headers
            .get("x-device-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("dev-unknown")
            .to_string();
    }
    if inventory.collected_at_ms == 0 {
        inventory.collected_at_ms = chrono::Utc::now().timestamp_millis();
    }
    // Bound stored payload sizes (a runaway process list should not bloat the row).
    inventory.processes.truncate(300);
    inventory.extensions.truncate(100);

    use app::DeviceInventoryStore as _;
    let store = aws_adapters::DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.core_table.clone(),
    );
    store.put_inventory(&org_id, &inventory).await.map_err(|e| {
        ApiErrorResponse::from_api(
            &audit_core::ApiError::Internal(format!("inventory upsert: {e}")),
            None,
        )
    })?;
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "stored",
            "device_id": inventory.device_id,
            "processes": inventory.processes.len(),
            "extensions": inventory.extensions.len(),
        })),
    ))
}

/// Get the latest active policy for the device’s organisation.
/// In dev mode, reads org_id from header or defaults.
async fn get_latest_policy(
    State(_state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErrorResponse> {
    let dev_mode = std::env::var("VG_DEV_CLAIMS").is_ok();
    let org_id = if dev_mode {
        headers
            .get("x-vg-org-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("local-org")
            .to_string()
    } else {
        // In production, we would extract from JWT; for now, default.
        "unknown".to_string()
    };

    // Return a default policy
    let policy = serde_json::json!({
        "org_id": org_id,
        "version": 1,
        "rules": [],
        "active": true,
    });
    Ok((StatusCode::OK, Json(policy)))
}

/// Ingest a batch of audit events from `vguardiand`'s upload worker.
///
/// Events arrive in the engine's signed envelope shape
/// (`vguardrail.event/v1`: `type`, `decision`, `risk_level`, `category`,
/// `findings`, …) — NOT the dashboard's audit shape — so each one is mapped
/// into the dev audit store here, which is what `GET /admin/audit` (and the
/// dashboard's violations/audit pages) read in local mode.
async fn post_events_batch(
    State(_state): State<AppState>,
    headers: HeaderMap,
    Json(batch): Json<AuditEventBatch>,
) -> Result<impl IntoResponse, ApiErrorResponse> {
    let device_id = headers
        .get("x-device-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("dev-unknown")
        .to_string();
    let org_id = headers
        .get("x-vg-org-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("local-org")
        .to_string();

    let str_of = |e: &serde_json::Value, k: &str| -> Option<String> {
        e.get(k).and_then(|v| v.as_str()).map(str::to_string)
    };
    let accepted = batch.events.len();
    for event in batch.events {
        let risk_level = str_of(&event, "risk_level").unwrap_or_else(|| "low".to_string());
        record_dev_audit(DevAuditEvent {
            event_id: str_of(&event, "event_id")
                .unwrap_or_else(|| format!("evt-{}", uuid::Uuid::new_v4())),
            org_id: org_id.clone(),
            device_id: str_of(&event, "device_id").unwrap_or_else(|| device_id.clone()),
            timestamp_ms: event
                .get("timestamp_ms")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
            event_type: str_of(&event, "type").unwrap_or_else(|| "prompt_scan".to_string()),
            severity: risk_level.clone(),
            action: str_of(&event, "decision").unwrap_or_else(|| "allow".to_string()),
            risk_level,
            category: str_of(&event, "category"),
            reason: str_of(&event, "reason"),
            details: event,
        });
    }

    let response = AuditEventBatchResponse {
        accepted,
        rejected: 0,
        upload_id: batch.upload_id.unwrap_or_else(|| format!("up-{}", uuid::Uuid::new_v4())),
        replayed: false,
    };

    Ok((StatusCode::OK, Json(response)))
}

// -----------------------------------------------------------------------------
// Local models (adjust if your actual models exist elsewhere)
// -----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DeviceRegistrationRequest {
    pub device_id: String,
    pub hostname: String,
    pub platform: String,
    pub agent_version: String,
    /// Hardware model, e.g. `MacBookPro18,3` (optional; older agents omit it).
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

#[derive(Debug, Serialize)]
pub struct DeviceRegistrationResponse {
    pub status: String,
    pub org_id: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize)]
pub struct AuditEvent {
    pub event_id: String,
    pub device_id: String,
    pub timestamp_ms: i64,
    pub event_type: String,
    pub severity: String,
    pub details: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct AuditEventBatch {
    /// Optional: the agent's uploader sends a bare `{"events": [...]}`.
    #[serde(default)]
    pub upload_id: Option<String>,
    /// Raw engine event envelopes — mapped field-by-field in the handler.
    pub events: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct AuditEventBatchResponse {
    pub accepted: usize,
    pub rejected: usize,
    pub upload_id: String,
    pub replayed: bool,
}