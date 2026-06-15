//! Errors produced while parsing, validating, signing, or loading policy bundles.
//!
//! Every variant represents a **fail-closed** condition: when any of these occur
//! during a load, the engine retains its last-good policy (doc 01 §6).

use thiserror::Error;

/// An error in the policy lifecycle.
#[derive(Debug, Error)]
pub enum PolicyError {
    /// The bundle JSON could not be parsed.
    #[error("malformed policy bundle: {0}")]
    Malformed(String),

    /// The `schema` field is not a version this engine supports.
    #[error("unsupported schema: expected one of {expected:?}, got {got:?}")]
    UnsupportedSchema {
        /// Supported schema identifiers.
        expected: Vec<&'static str>,
        /// The schema seen on the bundle.
        got: String,
    },

    /// The bundle had no signature block but one is required.
    #[error("policy bundle is unsigned")]
    Unsigned,

    /// The signature did not verify against the pinned key.
    #[error("policy signature verification failed: {0}")]
    BadSignature(String),

    /// The signature algorithm is not `ed25519`.
    #[error("unsupported signature algorithm: {0}")]
    BadSignatureAlg(String),

    /// The new bundle's version is not strictly greater than the active one.
    #[error("version rollback rejected: incoming {incoming} <= current {current}")]
    VersionRollback {
        /// Version on the incoming bundle.
        incoming: u32,
        /// Currently active version.
        current: u32,
    },

    /// The `previous_version` link does not match the active version.
    #[error("broken version chain: previous_version={incoming_prev:?} but current={current}")]
    BrokenChain {
        /// `previous_version` on the incoming bundle.
        incoming_prev: Option<u32>,
        /// Currently active version.
        current: u32,
    },

    /// A rule referenced a detector id the engine does not provide.
    #[error("rule '{rule_id}' references unknown detector '{detector}'")]
    UnknownDetector {
        /// The offending rule.
        rule_id: String,
        /// The unknown detector id.
        detector: String,
    },

    /// A field predicate referenced an unknown field path.
    #[error("rule '{rule_id}' references unknown field '{field}'")]
    UnknownField {
        /// The offending rule.
        rule_id: String,
        /// The unknown field path.
        field: String,
    },

    /// A regex in a `matches` predicate failed to compile (or exceeded limits).
    #[error("rule '{rule_id}' has invalid regex '{pattern}': {source}")]
    InvalidRegex {
        /// The offending rule.
        rule_id: String,
        /// The offending pattern.
        pattern: String,
        /// Underlying compile error.
        source: regex::Error,
    },

    /// A semantic constraint was violated (e.g. an exception without expiry).
    #[error("invalid policy: {0}")]
    Invalid(String),
}
