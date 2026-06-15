//! Authenticated request context derived from the verified Cognito JWT.
//!
//! These types are **the server equivalent** of what
//! `functions::request_context` / `functions::admin_request_context`
//! produced from API Gateway's `requestContext.authorizer.jwt.claims`.
//! Every `app::handle_*` function accepts them unchanged.

/// Per-request context for an endpoint (device) call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestContext {
    /// The calling device's id (Cognito `sub` or `custom:device_id`).
    pub device_id: String,
    /// The device's organization (Cognito `custom:org_id`).
    pub org_id: String,
}

impl From<RequestContext> for app::RequestContext {
    fn from(c: RequestContext) -> Self {
        Self {
            device_id: c.device_id,
            org_id: c.org_id,
        }
    }
}

/// Per-request context for a dashboard (admin) call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminRequestContext {
    /// The caller's org.
    pub org_id: String,
    /// The caller's role (Cognito `custom:role` or first element of
    /// `cognito:groups`).
    pub role: String,
}

impl AdminRequestContext {
    /// `true` for any read-capable role.
    #[must_use]
    pub fn can_read(&self) -> bool {
        matches!(
            self.role.as_str(),
            "super_admin" | "org_admin" | "auditor" | "viewer"
        )
    }

    /// `true` for any write-capable role.
    #[must_use]
    pub fn can_write(&self) -> bool {
        matches!(self.role.as_str(), "super_admin" | "org_admin")
    }
}
