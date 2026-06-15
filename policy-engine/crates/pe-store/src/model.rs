//! Row models for the local store.

use crate::error::StoreError;

/// Lifecycle status of a queued event (doc 05 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventStatus {
    /// Ready to be uploaded.
    Pending,
    /// Claimed by a worker, awaiting ack.
    Inflight,
    /// Successfully uploaded.
    Uploaded,
    /// Failed but retryable (with backoff).
    Failed,
    /// Exhausted retries; retained for forensics.
    Dead,
}

impl EventStatus {
    /// The database string form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            EventStatus::Pending => "pending",
            EventStatus::Inflight => "inflight",
            EventStatus::Uploaded => "uploaded",
            EventStatus::Failed => "failed",
            EventStatus::Dead => "dead",
        }
    }

    /// Parses a database string form.
    ///
    /// # Errors
    /// Returns [`StoreError::Integrity`] for an unrecognised value.
    pub fn parse(s: &str) -> Result<Self, StoreError> {
        match s {
            "pending" => Ok(EventStatus::Pending),
            "inflight" => Ok(EventStatus::Inflight),
            "uploaded" => Ok(EventStatus::Uploaded),
            "failed" => Ok(EventStatus::Failed),
            "dead" => Ok(EventStatus::Dead),
            other => Err(StoreError::Integrity(format!("bad status '{other}'"))),
        }
    }
}

/// An event enqueued for upload (doc 04 envelope, stored opaquely as bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedEvent {
    /// UUIDv7 event id (primary key, time-ordered).
    pub event_id: String,
    /// Event type (EVENT_MODEL).
    pub event_type: String,
    /// ISO-8601 creation time.
    pub created_at: String,
    /// Canonical JSON envelope bytes.
    pub payload: Vec<u8>,
    /// Detached Ed25519 signature over the payload.
    pub payload_sig: String,
}

/// A cached signed policy bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedPolicy {
    /// Policy version.
    pub version: u32,
    /// Full signed bundle JSON.
    pub bundle_json: Vec<u8>,
    /// Base64 signature.
    pub signature: String,
    /// Signing key id.
    pub key_id: String,
    /// Whether this is the active bundle.
    pub is_active: bool,
}

/// Persisted device identity / registration state (singleton row).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceState {
    /// Stable device id.
    pub device_id: String,
    /// Hostname.
    pub hostname: String,
    /// Agent version string.
    pub agent_version: String,
    /// Whether the device has registered with the cloud.
    pub registered: bool,
    /// Last successful policy sync timestamp.
    pub last_policy_sync: Option<String>,
    /// Last health/heartbeat timestamp.
    pub last_seen: Option<String>,
}

/// Outcome of an upload batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadOutcome {
    /// All events accepted.
    Success,
    /// The batch failed entirely.
    Failure,
    /// Some accepted, some rejected.
    Partial,
}

impl UploadOutcome {
    /// Database string form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            UploadOutcome::Success => "success",
            UploadOutcome::Failure => "failure",
            UploadOutcome::Partial => "partial",
        }
    }
}

/// A record of one upload attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadRecord {
    /// Batch id (UUID).
    pub batch_id: String,
    /// Start timestamp.
    pub started_at: String,
    /// Finish timestamp, if completed.
    pub finished_at: Option<String>,
    /// Number of events in the batch.
    pub event_count: u32,
    /// Count accepted by the cloud.
    pub accepted: Option<u32>,
    /// Count rejected by the cloud.
    pub rejected: Option<u32>,
    /// Final outcome.
    pub outcome: UploadOutcome,
}
