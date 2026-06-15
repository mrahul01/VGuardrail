//! Cognito RS256 JWT verification (Phase 3) with local dev bypass.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

use crate::error::ApiErrorResponse;
use crate::request_ctx::{AdminRequestContext, RequestContext};
use crate::state::AppState;

// ── JWKS cache (unchanged, but dev mode will bypass it entirely) ─────────

pub struct JwksCache {
    issuer: String,
    keys: RwLock<CachedKeys>,
    http: reqwest::Client,
    ttl: Duration,
}

#[derive(Default)]
struct CachedKeys {
    by_kid: HashMap<String, DecodingKey>,
    fetched_at: Option<Instant>,
}

impl JwksCache {
    pub async fn load(http: &reqwest::Client, issuer: &str) -> Result<Self, String> {
        let cache = Self {
            issuer: issuer.to_string(),
            keys: RwLock::new(CachedKeys::default()),
            http: http.clone(),
            ttl: Duration::from_secs(3600),
        };
        // In dev mode, we will never call `key()`, so we can return immediately
        // without fetching JWKS. But to avoid any potential usage, we still create
        // the cache. The real bypass is inside `verify()`.
        if std::env::var("VG_DEV_CLAIMS").is_ok() {
            return Ok(cache);
        }
        cache.refresh().await?;
        Ok(cache)
    }

    pub async fn key(&self, kid: &str) -> Result<DecodingKey, String> {
        if let Some(k) = self.keys.read().unwrap().by_kid.get(kid).cloned() {
            return Ok(k);
        }
        self.refresh().await?;
        self.keys
            .read()
            .unwrap()
            .by_kid
            .get(kid)
            .cloned()
            .ok_or_else(|| format!("unknown kid {kid} after JWKS refresh"))
    }

    pub async fn refresh(&self) -> Result<(), String> {
        let url = format!("{}/.well-known/jwks.json", self.issuer);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("jwks fetch {url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("jwks fetch {url}: HTTP {}", resp.status()));
        }
        let body: Jwks = resp
            .json()
            .await
            .map_err(|e| format!("jwks parse: {e}"))?;
        let mut map = HashMap::new();
        for k in body.keys {
            if k.kty != "RSA" {
                continue;
            }
            if let (Some(n), Some(e), Some(kid)) = (k.n.as_deref(), k.e.as_deref(), k.kid.as_deref()) {
                if let Ok(dk) = DecodingKey::from_rsa_components(n, e) {
                    map.insert(kid.to_string(), dk);
                }
            }
        }
        let mut guard = self.keys.write().unwrap();
        guard.by_kid = map;
        guard.fetched_at = Some(Instant::now());
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn seeded(
        issuer: impl Into<String>,
        http: reqwest::Client,
        keys: HashMap<String, DecodingKey>,
    ) -> Self {
        Self {
            issuer: issuer.into(),
            keys: RwLock::new(CachedKeys {
                by_kid: keys,
                fetched_at: Some(Instant::now()),
            }),
            http,
            ttl: Duration::from_secs(3600),
        }
    }
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kty: String,
    kid: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(default, rename = "custom:device_id")]
    pub custom_device_id: Option<String>,
    #[serde(rename = "custom:org_id")]
    pub custom_org_id: String,
    #[serde(default, rename = "custom:role")]
    pub custom_role: Option<String>,
    #[serde(default, rename = "cognito:groups")]
    pub cognito_groups: Vec<String>,
    #[serde(default)]
    pub aud: Option<serde_json::Value>,
    #[serde(default)]
    pub iss: Option<String>,
}

impl Claims {
    #[must_use]
    pub fn device_id(&self) -> &str {
        self.custom_device_id.as_deref().unwrap_or(self.sub.as_str())
    }

    #[must_use]
    pub fn role(&self) -> String {
        if let Some(r) = &self.custom_role {
            if !r.is_empty() {
                return r.clone();
            }
        }
        for g in &self.cognito_groups {
            if !g.is_empty() {
                return g.clone();
            }
        }
        "viewer".to_string()
    }
}

// ── Auth middleware (state injected via `from_fn_with_state`) ────────────

/// Require an **admin** (dashboard) token. Inserts the verified
/// [`AdminRequestContext`] into the request extensions on success.
pub async fn require_admin_mw(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    // Dev-mode early exit: when VG_DEV_CLAIMS=1 and x-vg-role / x-vg-org-id
    // headers are present, trust the request immediately without any JWT
    // validation.  This allows the dashboard to omit the Authorization header
    // entirely in local development.
    if let Some(ctx) = try_dev_admin(&req) {
        req.extensions_mut().insert(ctx);
        return next.run(req).await;
    }
    match verify(&state, req.headers()).await {
        Ok(Verified::Admin(ctx)) => {
            req.extensions_mut().insert(ctx);
            next.run(req).await
        }
        Ok(Verified::Device(_)) => unauthorized("admin role required"),
        Err(msg) => unauthorized(&msg),
    }
}

/// Require a **device** (agent) token. Inserts the verified
/// [`RequestContext`] into the request extensions on success.
pub async fn require_device_mw(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    // Dev-mode early exit: when VG_DEV_CLAIMS=1 and x-vg-role / x-vg-org-id
    // headers are present, trust the request immediately without any JWT
    // validation.
    if let Some(ctx) = try_dev_device(&req) {
        req.extensions_mut().insert(ctx);
        return next.run(req).await;
    }
    match verify(&state, req.headers()).await {
        Ok(Verified::Device(ctx)) => {
            req.extensions_mut().insert(ctx);
            next.run(req).await
        }
        Ok(Verified::Admin(_)) => unauthorized("device token required"),
        Err(msg) => unauthorized(&msg),
    }
}

// ── Verified / context types ───────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum Verified {
    Device(RequestContext),
    Admin(AdminRequestContext),
}

impl From<Verified> for RequestContext {
    fn from(v: Verified) -> Self {
        match v {
            Verified::Device(c) => c,
            Verified::Admin(c) => RequestContext {
                device_id: format!("admin:{}", c.org_id),
                org_id: c.org_id,
            },
        }
    }
}

impl From<Verified> for AdminRequestContext {
    fn from(v: Verified) -> Self {
        match v {
            Verified::Admin(c) => c,
            Verified::Device(c) => AdminRequestContext {
                org_id: c.org_id,
                role: "device".to_string(),
            },
        }
    }
}

// ── Dev-mode helpers (early-exit before verify()) ─────────────────────

/// If `VG_DEV_CLAIMS=1` and both `x-vg-role` and `x-vg-org-id` headers
/// are present and non-empty, return `Some(AdminRequestContext)` to bypass
/// all JWT verification.  Returns `None` otherwise.
fn try_dev_admin(req: &Request<Body>) -> Option<AdminRequestContext> {
    if !std::env::var("VG_DEV_CLAIMS").is_ok() {
        return None;
    }
    let role = req
        .headers()
        .get("x-vg-role")?
        .to_str()
        .ok()
        .filter(|s| !s.is_empty())?;
    let org_id = req
        .headers()
        .get("x-vg-org-id")?
        .to_str()
        .ok()
        .filter(|s| !s.is_empty())?;
    // Only produce an admin context if the role is recognised as admin.
    if role.eq_ignore_ascii_case("org_admin") || role.eq_ignore_ascii_case("super_admin") {
        Some(AdminRequestContext {
            org_id: org_id.to_string(),
            role: role.to_string(),
        })
    } else {
        None
    }
}

/// If `VG_DEV_CLAIMS=1` and both `x-vg-role` and `x-vg-org-id` headers
/// are present and non-empty, return `Some(RequestContext)` to bypass
/// all JWT verification.  Returns `None` otherwise.
fn try_dev_device(req: &Request<Body>) -> Option<RequestContext> {
    if !std::env::var("VG_DEV_CLAIMS").is_ok() {
        return None;
    }
    let org_id = req
        .headers()
        .get("x-vg-org-id")?
        .to_str()
        .ok()
        .filter(|s| !s.is_empty())?;
    let device_id = req
        .headers()
        .get("x-device-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .unwrap_or("dev-unknown");
    Some(RequestContext {
        device_id: device_id.to_string(),
        org_id: org_id.to_string(),
    })
}

/// Core verification logic: if `VG_DEV_CLAIMS=1`, accept headers or defaults.
/// Otherwise, perform full RS256 Cognito JWT validation.
async fn verify(state: &AppState, headers: &HeaderMap) -> Result<Verified, String> {
    // ----- DEV MODE: bypass all crypto and use headers / defaults -----
    if std::env::var("VG_DEV_CLAIMS").is_ok() {
        let org_id = headers
            .get("x-vg-org-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "local-org".to_string());

        // Determine if this is an admin request (by role header or presence of device claim)
        let role = headers
            .get("x-vg-role")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("viewer");

        // If the request has a device_id header or it's a device registration, treat as device.
        // For simplicity, we treat any request without "admin" role as a device request.
        // But we also need to distinguish device vs admin for middleware.
        let is_admin = role.eq_ignore_ascii_case("org_admin") || role.eq_ignore_ascii_case("super_admin");
        
        if is_admin {
            return Ok(Verified::Admin(AdminRequestContext {
                org_id,
                role: role.to_string(),
            }));
        } else {
            let device_id = headers
                .get("x-device-id")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("dev-unknown")
                .to_string();
            return Ok(Verified::Device(RequestContext {
                device_id,
                org_id,
            }));
        }
    }

    // ----- PRODUCTION MODE: full JWT validation -----
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| "missing or malformed Authorization header".to_string())?;

    let header = decode_header(token).map_err(|e| format!("bad JWT header: {e}"))?;
    if header.alg != Algorithm::RS256 {
        return Err(format!("unsupported alg: {:?}", header.alg));
    }
    let kid = header.kid.ok_or_else(|| "JWT header missing kid".to_string())?;
    let key = state.jwks.key(&kid).await?;

    let mut audiences: Vec<String> = vec![state.resource.app_client_id.clone()];
    if let Ok(dashboard_aud) = std::env::var("VG_DASHBOARD_CLIENT_ID") {
        if !dashboard_aud.trim().is_empty() {
            audiences.push(dashboard_aud);
        }
    }

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&audiences);
    validation.set_issuer(&[cognito_issuer(&state.resource).as_str()]);
    validation.leeway = 30;

    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|e| format!("JWT verify: {e}"))?;
    let claims = data.claims;

    if claims.custom_org_id.trim().is_empty() {
        return Err("missing custom:org_id claim".into());
    }

    if claims.custom_device_id.is_some() {
        Ok(Verified::Device(RequestContext {
            device_id: claims.device_id().to_string(),
            org_id: claims.custom_org_id.clone(),
        }))
    } else {
        Ok(Verified::Admin(AdminRequestContext {
            org_id: claims.custom_org_id.clone(),
            role: claims.role(),
        }))
    }
}

fn cognito_issuer(resource: &aws_adapters::ResourceConfig) -> String {
    if let Ok(issuer) = std::env::var("VG_COGNITO_ISSUER") {
        return issuer;
    }
    format!("https://cognito-idp.amazonaws.com/{}", resource.user_pool_id)
}

fn unauthorized(msg: &str) -> Response {
    let body = audit_core::ErrorResponse {
        error: audit_core::ErrorBody {
            code: "unauthorized".into(),
            message: msg.into(),
            request_id: None,
        },
    };
    (
        StatusCode::UNAUTHORIZED,
        [("www-authenticate", "Bearer")],
        Json(body),
    )
        .into_response()
}

pub trait FromRequestExt {
    fn admin(&self) -> Result<AdminRequestContext, ApiErrorResponse>;
    fn device(&self) -> Result<RequestContext, ApiErrorResponse>;
    fn verified(&self) -> Option<Verified>;
}

impl FromRequestExt for Request<Body> {
    fn admin(&self) -> Result<AdminRequestContext, ApiErrorResponse> {
        if let Some(v) = self.extensions().get::<Verified>().cloned() {
            return Ok(v.into());
        }
        if let Some(c) = self.extensions().get::<AdminRequestContext>().cloned() {
            return Ok(c);
        }
        Err(ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("admin auth required".into()),
            None,
        ))
    }

    fn device(&self) -> Result<RequestContext, ApiErrorResponse> {
        if let Some(v) = self.extensions().get::<Verified>().cloned() {
            return Ok(v.into());
        }
        if let Some(c) = self.extensions().get::<RequestContext>().cloned() {
            return Ok(c);
        }
        Err(ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("device auth required".into()),
            None,
        ))
    }

    fn verified(&self) -> Option<Verified> {
        self.extensions().get::<Verified>().cloned()
    }
}