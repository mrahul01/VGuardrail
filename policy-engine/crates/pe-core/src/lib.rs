//! # pe-core
//!
//! The dependency-free **domain model** for the VGuardrail Policy Engine.
//!
//! Following Clean Architecture, this crate sits at the centre of the workspace:
//! it depends on nothing but `serde`/`thiserror` and is depended upon by every
//! adapter (`pe-grpc`, `pe-store`) and use-case crate (`pe-dsl`, `pe-detectors`,
//! `pe-engine`).
//!
//! It defines:
//! * the enumerations of the decision domain ([`Action`], [`Severity`],
//!   [`RiskLevel`], [`Classification`], [`Source`], [`Role`], [`Category`]);
//! * the request input ([`ScanInput`], [`ScanContext`]);
//! * detector output ([`Finding`], [`Span`]);
//! * the [`Decision`] returned by evaluation;
//! * the [`Detector`] extension trait and supporting [`Budget`]/[`Clock`].
//!
//! Evaluation logic itself lives in `pe-dsl`; this crate only models the data and
//! the trait boundaries.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod context;
mod decision;
mod detector;
mod enums;
mod error;
mod finding;
mod time;

pub use context::{FileContext, RepoContext, ScanContext, ScanInput, UserContext, MAX_SCAN_BYTES};
pub use decision::{Decision, Suppression};
pub use detector::{
    ClassificationDetector, Detector, LanguageGuess, PiiDetector, SecretDetector,
    SourceCodeDetector,
};
pub use enums::{Action, Category, Classification, RiskLevel, Role, Severity, Source};
pub use error::DomainError;
pub use finding::{primary_category, redact, Finding, Span};
pub use time::{Budget, Clock, ManualClock, SystemClock};
