//! Shared wiring for the Lambda function binaries: client/config bootstrap,
//! request-context (JWT claim) extraction, and response helpers.
#![forbid(unsafe_code)]

use std::time::{SystemTime, UNIX_EPOCH};

use app::RequestContext;
use audit_core::ApiError;
use aws_adapters::{AwsClients, ResourceConfig};
use lambda_http::{Body, Request, RequestExt, Response};

/// Loaded clients + config, built once per cold start.
pub struct AppCtx {
    /// AWS SDK clients.
    pub clients: AwsClients,
    /// Resource names + config.
    pub config: ResourceConfig,
}

impl AppCtx {
    /// Loads config from the environment and builds the AWS clients.
    ///
    /// # Errors
    /// Returns the missing-variable message if config is incomplete.
    pub async fn load() -> Result<Self, String> {
        let config = ResourceConfig::from_env()?;
        let clients = AwsClients::load().await;
        Ok(Self { clients, config })
    }
}

/// Initializes JSON structured logging (idempotent across cold starts).
pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .without_time()
        .try_init();
}

/// Current time in Unix milliseconds.
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Current time as an ISO-8601-ish string (seconds precision, no date dep).
#[must_use]
pub fn now_iso() -> String {
    // Minimal: emit epoch millis tagged; good enough for a health probe field.
    format!("{}", now_ms())
}

/// Reads a request header as an owned string.
#[must_use]
pub fn header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// Reads the raw request body bytes.
#[must_use]
pub fn body_bytes(req: &Request) -> Vec<u8> {
    match req.body() {
        Body::Text(s) => s.clone().into_bytes(),
        Body::Binary(b) => b.clone(),
        Body::Empty => Vec::new(),
    }
}

/// Extracts the authenticated [`RequestContext`] from the API Gateway JWT
/// authorizer claims. In dev/e2e (`VG_DEV_CLAIMS=1`) it falls back to the
/// `x-vg-device-id` / `x-vg-org-id` headers so the flow can be exercised without
/// a live authorizer (e.g. LocalStack).
///
/// # Errors
/// Returns [`ApiError::Unauthorized`] when claims are absent/incomplete.
pub fn request_context(req: &Request) -> Result<RequestContext, ApiError> {
    if std::env::var("VG_DEV_CLAIMS").as_deref() == Ok("1") {
        let device_id = header_value(req, "x-vg-device-id");
        let org_id = header_value(req, "x-vg-org-id");
        if let (Some(device_id), Some(org_id)) = (device_id, org_id) {
            return Ok(RequestContext { device_id, org_id });
        }
        return Err(ApiError::Unauthorized("missing dev claim headers".into()));
    }

    let claims = match req.request_context() {
        lambda_http::request::RequestContext::ApiGatewayV2(ctx) => ctx
            .authorizer
            .and_then(|a| a.jwt)
            .map(|j| j.claims)
            .unwrap_or_default(),
        _ => return Err(ApiError::Unauthorized("no JWT authorizer context".into())),
    };

    let device_id = claims
        .get("custom:device_id")
        .or_else(|| claims.get("sub"))
        .cloned()
        .ok_or_else(|| ApiError::Unauthorized("missing device claim".into()))?;
    let org_id = claims
        .get("custom:org_id")
        .cloned()
        .ok_or_else(|| ApiError::Unauthorized("missing org claim".into()))?;
    Ok(RequestContext { device_id, org_id })
}

/// Authenticated org-scoped context for dashboard/admin routes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminRequestContext {
    /// Caller org.
    pub org_id: String,
    /// Caller role/group.
    pub role: String,
}

/// Extracts the org-scoped JWT claims for admin routes.
pub fn admin_request_context(req: &Request) -> Result<AdminRequestContext, ApiError> {
    if std::env::var("VG_DEV_CLAIMS").as_deref() == Ok("1") {
        let org_id = header_value(req, "x-vg-org-id");
        let role = header_value(req, "x-vg-role");
        if let (Some(org_id), Some(role)) = (org_id, role) {
            return Ok(AdminRequestContext { org_id, role });
        }
        return Err(ApiError::Unauthorized("missing dev claim headers".into()));
    }

    let claims = match req.request_context() {
        lambda_http::request::RequestContext::ApiGatewayV2(ctx) => ctx
            .authorizer
            .and_then(|a| a.jwt)
            .map(|j| j.claims)
            .unwrap_or_default(),
        _ => return Err(ApiError::Unauthorized("no JWT authorizer context".into())),
    };
    let org_id = claims
        .get("custom:org_id")
        .cloned()
        .ok_or_else(|| ApiError::Unauthorized("missing org claim".into()))?;
    let role = claims
        .get("custom:role")
        .cloned()
        .or_else(|| claims.get("cognito:groups").cloned())
        .ok_or_else(|| ApiError::Unauthorized("missing role claim".into()))?;
    Ok(AdminRequestContext { org_id, role })
}

/// Builds a JSON response with the given status.
#[must_use]
pub fn json_response(status: u16, body: &impl serde::Serialize) -> Response<Body> {
    let bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(bytes))
        .expect("response builds")
}

/// Builds the error-envelope response for an [`ApiError`].
#[must_use]
pub fn error_response(err: &ApiError, request_id: Option<String>) -> Response<Body> {
    json_response(err.status(), &err.to_response(request_id))
}
