//! # pe-engine
//!
//! The orchestration layer of the VGuardrail Policy Engine. It wires the detector
//! registry ([`pe_detectors`]), the policy DSL evaluator ([`pe_dsl`]), and the
//! local store ([`pe_store`]) into the evaluation pipeline, and exposes it over
//! the gRPC contract ([`pe_grpc`]).
//!
//! * [`EngineService`] — the pipeline + gRPC handlers.
//! * [`EngineConfig`] — runtime configuration.
//! * [`score_risk`] — the deterministic risk model (doc 02 §6).
//! * [`build_runtime`] — assembles a ready service from configuration.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod code_classifier;
mod config;
mod event;
mod http;
mod llm;
mod risk;
mod runtime;
mod service;

pub use code_classifier::{CodeClassifier, CodeClassifierConfig};
pub use config::EngineConfig;
pub use event::{build_event, primary_event_type};
pub use llm::{LlmClassifier, LlmConfig, LlmVerdict};
pub use risk::{score_risk, severity_to_risk};
pub use runtime::{build_runtime, runtime_params_from_env, RuntimeError, RuntimeParams};
pub use service::{EngineService, LoadOutcome};
