//! HTTP error mapping.
//!
//! The wire envelope is **byte-identical** to what the Lambda functions
//! emit today (`{ "error": { "code", "message", "request_id"? } }`),
//! so existing agents and dashboards keep parsing responses
//! unchanged.

use audit_core::{ApiError, ErrorResponse};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

/// Wire body returned for any 4xx / 5xx response.
#[derive(Debug)]
pub struct ApiErrorResponse(pub ErrorResponse);

impl ApiErrorResponse {
    /// Builds a response from a domain [`ApiError`].
    #[must_use]
    pub fn from_api(err: &ApiError, request_id: Option<String>) -> Self {
        Self(err.to_response(request_id))
    }
}

impl IntoResponse for ApiErrorResponse {
    fn into_response(self) -> Response {
        let status = match self.0.error.code.as_str() {
            "bad_request" => StatusCode::BAD_REQUEST,
            "unauthorized" => StatusCode::UNAUTHORIZED,
            "not_found" => StatusCode::NOT_FOUND,
            "conflict" => StatusCode::CONFLICT,
            "payload_too_large" => StatusCode::PAYLOAD_TOO_LARGE,
            "unprocessable" => StatusCode::UNPROCESSABLE_ENTITY,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self.0)).into_response()
    }
}

/// Convenience constructor used by route handlers.
pub fn api_error_response(err: &ApiError, request_id: Option<String>) -> ApiErrorResponse {
    ApiErrorResponse::from_api(err, request_id)
}

impl From<ApiError> for ApiErrorResponse {
    fn from(err: ApiError) -> Self {
        Self::from_api(&err, None)
    }
}

impl From<&ApiError> for ApiErrorResponse {
    fn from(err: &ApiError) -> Self {
        Self::from_api(err, None)
    }
}
