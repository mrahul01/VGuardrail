//! Domain-level errors shared across the workspace.

use thiserror::Error;

/// Errors originating in the domain layer.
///
/// Adapter and use-case crates define their own richer error types and may wrap
/// these; `pe-core` stays intentionally small.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    /// A value was outside its permitted range.
    #[error("value out of range: {0}")]
    OutOfRange(String),

    /// A required field was missing.
    #[error("missing required field: {0}")]
    MissingField(String),

    /// An identifier did not refer to a known entity.
    #[error("unknown identifier: {0}")]
    Unknown(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_is_informative() {
        assert_eq!(
            DomainError::MissingField("user_id".into()).to_string(),
            "missing required field: user_id"
        );
    }
}
