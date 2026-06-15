//! # pe-store
//!
//! Local SQLite persistence for the VGuardrail Policy Engine: the outbound event
//! queue (with retry/backoff state machine), the signed-policy cache, device
//! state, and upload bookkeeping. Schema and semantics documented inline.
//!
//! Production builds enable the `sqlcipher` feature for AES-256 at-rest
//! encryption with a key from the macOS Keychain; tests run on plain SQLite.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod error;
mod model;
mod store;

pub use error::{Result, StoreError};
pub use model::{CachedPolicy, DeviceState, EventStatus, QueuedEvent, UploadOutcome, UploadRecord};
pub use store::{Store, SUPPORTED_VERSION};
