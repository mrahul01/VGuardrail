//! # audit-core
//!
//! Shared domain for the VGuardrail Audit Cloud: the audit event envelope (wire-
//! compatible with the agent), the tamper-evident per-device hash chain, the
//! idempotency keys for safe upload retries, and the API error envelope.
//!
//! Reuses `pe-core` enums so the cloud, engine, and agent agree on wire values.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod error;
mod event;
mod hash;
mod idempotency;

pub use error::{ApiError, ErrorBody, ErrorResponse};
pub use event::{AuditEvent, AuditFinding, EventType};
pub use hash::{compute_event_hash, verify_event_hash, GENESIS_PREV};
pub use idempotency::{derive_upload_id, effective_upload_id};
