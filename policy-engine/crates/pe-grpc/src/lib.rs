//! # pe-grpc
//!
//! The VGuardrail Policy Engine **gRPC contract**: the tonic-generated client and
//! server types from `proto/policy_engine/v1/policy_engine.proto`, conversions
//! between the wire types and the `pe-core` domain ([`map`]), and the Unix-domain
//! socket transport helper ([`transport`]).
//!
//! It depends only on `pe-core` (for mapping), so it builds before the engine.
//! The engine implements the generated [`PolicyEngine`] service trait. See
//! the policy-engine README.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

/// Generated protobuf/tonic types for `vguardrail.policy_engine.v1`.
pub mod pb {
    #![allow(missing_docs, clippy::all, clippy::pedantic)]
    tonic::include_proto!("vguardrail.policy_engine.v1");
}

pub mod map;

#[cfg(unix)]
pub mod transport;

pub use pb::policy_engine_client::PolicyEngineClient;
pub use pb::policy_engine_server::{PolicyEngine, PolicyEngineServer};
