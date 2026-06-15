//! The API error envelope and a typed error with HTTP status mapping.

use serde::Serialize;
use thiserror::Error;

/// Wire error envelope returned for all 4xx/5xx responses.
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    /// The error detail.
    pub error: ErrorBody,
}

/// Error detail body.
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    /// Stable machine-readable code.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Correlating request id, if available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Typed API error. Each variant maps to an HTTP status + stable code.
#[derive(Debug, Error)]
#[allow(missing_docs)] // variants documented via their Display strings
pub enum ApiError {
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("payload too large: {0}")]
    PayloadTooLarge(String),
    #[error("unprocessable: {0}")]
    Unprocessable(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl ApiError {
    /// HTTP status code.
    #[must_use]
    pub fn status(&self) -> u16 {
        match self {
            ApiError::BadRequest(_) => 400,
            ApiError::Unauthorized(_) => 401,
            ApiError::NotFound(_) => 404,
            ApiError::Conflict(_) => 409,
            ApiError::PayloadTooLarge(_) => 413,
            ApiError::Unprocessable(_) => 422,
            ApiError::Internal(_) => 500,
        }
    }

    /// Stable machine-readable code.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad_request",
            ApiError::Unauthorized(_) => "unauthorized",
            ApiError::NotFound(_) => "not_found",
            ApiError::Conflict(_) => "conflict",
            ApiError::PayloadTooLarge(_) => "payload_too_large",
            ApiError::Unprocessable(_) => "unprocessable",
            ApiError::Internal(_) => "internal_error",
        }
    }

    /// Builds the wire envelope.
    #[must_use]
    pub fn to_response(&self, request_id: Option<String>) -> ErrorResponse {
        ErrorResponse {
            error: ErrorBody {
                code: self.code().to_string(),
                message: self.to_string(),
                request_id,
            },
        }
    }
}
