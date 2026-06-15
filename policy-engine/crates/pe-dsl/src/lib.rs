//! # pe-dsl
//!
//! The VGuardrail **Policy DSL**: the signed, versioned policy bundle model, its
//! exceptions, the fail-closed loader with three-slot retention, and the
//! deterministic evaluator.
//!
//! Depends only on `pe-core` (domain types) plus serde/regex/ed25519, keeping it
//! decoupled from the detector implementations in `pe-detectors`: the engine
//! derives [`EvalFacts`] and hands them to [`evaluate`].
//!
//!
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod canonical;
mod error;
mod eval;
mod model;
mod policy_set;
mod regexcache;
mod signature;
mod validate;

pub use canonical::{canonicalize, signing_bytes};
pub use error::PolicyError;
pub use eval::{evaluate, EvalFacts, RuleDecision};
pub use model::{
    Condition, DetectorOp, DetectorPredicate, Exception, FieldOp, FieldPredicate, PolicyBundle,
    Rule, SignatureBlock, Subject, SubjectKind, DEFAULT_MIN_CONFIDENCE, SUPPORTED_SCHEMAS,
};
pub use policy_set::{LoadResult, PolicySet};
pub use signature::{sign_bundle, verify_bundle, verifying_key_from_b64};
pub use validate::{validate_bundle, KNOWN_FIELDS};
