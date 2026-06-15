//! The audit event envelope as produced by the agent, plus the server-assigned
//! hash-chain fields. Field names match the agent's wire format exactly so the
//! cloud deserializes what the agent serializes.

use std::collections::BTreeMap;

use pe_core::{Action, Category, Classification, RiskLevel, Severity, Source, Suppression};
use serde::{Deserialize, Serialize};

/// Audit event types (EVENT_MODEL.md). Serde uses the variant names verbatim,
/// which are the canonical PascalCase wire values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[allow(missing_docs)] // variant names are self-describing wire values
pub enum EventType {
    PromptSubmitted,
    PolicyEvaluated,
    PromptAllowed,
    PromptWarned,
    WarningAccepted,
    WarningRejected,
    PromptBlocked,
    PolicyViolation,
    UploadSuccess,
    UploadFailure,
    AgentStarted,
    PolicyUpdated,
}

/// A redacted detector finding (flat span to match the agent wire format).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditFinding {
    /// Namespaced detector id, e.g. `secret.aws_access_key`.
    pub detector_id: String,
    /// Detector category.
    pub category: Category,
    /// Specific kind, e.g. `aws_access_key`.
    pub kind: String,
    /// Start byte offset of the match.
    pub span_start: u64,
    /// End byte offset of the match.
    pub span_end: u64,
    /// Confidence in `[0,1]`.
    pub confidence: f32,
    /// Finding severity.
    pub severity: Severity,
    /// Redacted preview — never a raw secret.
    pub redacted_preview: String,
    /// Detector-specific metadata.
    #[serde(default)]
    pub meta: BTreeMap<String, String>,
}

/// The audit envelope. `event_hash`/`previous_event_hash` are assigned by the
/// server at ingest (skipped on serialize when absent so they never affect the
/// canonical content hash of an inbound event).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEvent {
    /// UUIDv7 event id (unique, time-ordered).
    pub event_id: String,
    /// Envelope schema id.
    #[serde(default = "default_schema")]
    pub schema: String,
    /// Event type (EVENT_MODEL).
    #[serde(rename = "type")]
    pub event_type: EventType,
    /// Event time, Unix milliseconds.
    pub timestamp_ms: i64,
    /// Acting user id.
    pub user_id: String,
    /// Originating device id.
    pub device_id: String,
    /// Origin surface (browser/ide/cli/api).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    /// External AI provider.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Application name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    /// Enforcement decision.
    pub decision: Action,
    /// Aggregate risk level.
    pub risk_level: RiskLevel,
    /// Derived data classification.
    pub classification: Classification,
    /// Policy version used for the decision.
    pub policy_version: u32,
    /// Winning rule id, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_rule_id: Option<String>,
    /// Decision category (snake_case wire name, e.g. `company_confidential`).
    ///
    /// Kept as a plain `String` rather than `pe_core::Category` so events from
    /// old and new engines interoperate: an engine that knows more category
    /// variants than this build can still upload, and old events without the
    /// field still deserialize. Absent on serialize when unset so it never
    /// perturbs the canonical content hash of legacy events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Human-readable explanation of the decision, emitted by the engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Exceptions applied during evaluation.
    #[serde(default)]
    pub suppressions: Vec<Suppression>,
    /// True if the scan was budget-truncated.
    #[serde(default)]
    pub incomplete: bool,
    /// Redacted findings.
    #[serde(default)]
    pub findings: Vec<AuditFinding>,

    /// Server-assigned: SHA-256 over canonical content + previous hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_hash: Option<String>,
    /// Server-assigned: the prior event's hash for this device (chain link).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_event_hash: Option<String>,
}

fn default_schema() -> String {
    "vguardrail.event/v1".to_string()
}

impl AuditEvent {
    /// True if both hash-chain fields are populated.
    #[must_use]
    pub fn is_chained(&self) -> bool {
        self.event_hash.is_some() && self.previous_event_hash.is_some()
    }

    /// The event's category for list/summary views: the engine-provided
    /// top-level `category` when present, otherwise the highest-severity
    /// finding's category wire name (first wins on ties).
    #[must_use]
    pub fn effective_category(&self) -> Option<String> {
        if let Some(category) = &self.category {
            return Some(category.clone());
        }
        self.findings
            .iter()
            .reduce(|best, f| {
                if f.severity.rank() > best.severity.rank() {
                    f
                } else {
                    best
                }
            })
            .map(|f| f.category.wire_name().to_string())
    }
}
