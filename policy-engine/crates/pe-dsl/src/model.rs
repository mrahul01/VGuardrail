//! The serializable policy DSL model: bundles, rules, exceptions, and the
//! boolean condition tree.

use std::collections::BTreeMap;

use pe_core::{Action, Severity};
use serde::{Deserialize, Serialize};

/// Schema identifiers this build understands.
pub const SUPPORTED_SCHEMAS: &[&str] = &["vguardrail.policy/v1"];

/// Default `min_confidence` for a rule when unspecified (doc 00 P-13).
pub const DEFAULT_MIN_CONFIDENCE: f32 = 0.8;

fn default_true() -> bool {
    true
}
fn default_min_confidence() -> f32 {
    DEFAULT_MIN_CONFIDENCE
}

/// A signed, versioned policy bundle (doc 01 §2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PolicyBundle {
    /// Format/schema version, e.g. `"vguardrail.policy/v1"`.
    pub schema: String,
    /// Monotonic policy version.
    pub version: u32,
    /// The version this bundle supersedes; `None` only for the genesis bundle.
    #[serde(default)]
    pub previous_version: Option<u32>,
    /// Owning organization.
    pub org_id: String,
    /// Creation timestamp (ISO-8601, informational).
    pub created_at: String,
    /// Tenant-configurable action when no rule matches (`allow`/`warn`/`block`).
    pub default_action: Action,
    /// Sanctioned exceptions, evaluated before rules (doc 01 §4a).
    #[serde(default)]
    pub exceptions: Vec<Exception>,
    /// The ordered rule set.
    #[serde(default)]
    pub rules: Vec<Rule>,
    /// Detached signature over the canonical bundle (sans this field).
    #[serde(default)]
    pub signature: Option<SignatureBlock>,
}

/// An Ed25519 detached signature block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignatureBlock {
    /// Algorithm identifier; must be `"ed25519"`.
    pub alg: String,
    /// Key identifier (for rotation).
    pub key_id: String,
    /// Base64-encoded 64-byte signature.
    pub value: String,
}

/// A single policy rule (doc 01 §3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    /// Stable rule identifier.
    pub rule_id: String,
    /// Human-readable name.
    pub name: String,
    /// Optional description.
    #[serde(default)]
    pub description: String,
    /// Whether the rule participates in evaluation.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Severity contributed when the rule matches.
    pub severity: Severity,
    /// Lower number = higher precedence on ties.
    #[serde(default)]
    pub priority: u16,
    /// The action to take when the rule matches.
    pub action: Action,
    /// Minimum finding confidence required to count toward this rule.
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f32,
    /// The boolean condition tree.
    #[serde(rename = "match")]
    pub match_: Condition,
    /// Detector-specific parameters.
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    /// Message surfaced to the user on warn/block.
    #[serde(default)]
    pub message: String,
    /// Free-form tags.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A sanctioned, time-bounded exception that suppresses a rule for a subject
/// (doc 01 §4a). Evaluated **before** rules and can only lower enforcement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exception {
    /// Stable exception identifier.
    pub exception_id: String,
    /// The rule this exception suppresses.
    pub rule_id: String,
    /// Who the exception applies to.
    pub subject: Subject,
    /// Approving admin (RBAC: Security/Super Admin).
    pub approved_by: String,
    /// Justification (auditable).
    pub reason: String,
    /// Creation timestamp (ISO-8601, informational).
    pub created_at: String,
    /// Expiry as Unix epoch **milliseconds**. Required; a perpetual bypass is
    /// forbidden, so this is never optional.
    pub expires_at: i64,
}

/// The subject an exception applies to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subject {
    /// Subject kind.
    pub kind: SubjectKind,
    /// Subject identifier (user id, device id, or group name).
    pub id: String,
}

/// The kind of an exception subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubjectKind {
    /// A specific user.
    User,
    /// A specific device.
    Device,
    /// A named group.
    Group,
}

/// A boolean condition tree node (doc 01 §4). Untagged: the JSON shape selects
/// the variant (`all`/`any`/`not` keys, or a predicate's `detector`/`field`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Condition {
    /// Logical AND.
    All {
        /// Sub-conditions; all must hold.
        all: Vec<Condition>,
    },
    /// Logical OR.
    Any {
        /// Sub-conditions; at least one must hold.
        any: Vec<Condition>,
    },
    /// Logical NOT.
    Not {
        /// The negated sub-condition.
        not: Box<Condition>,
    },
    /// A predicate over detector output.
    Detector(DetectorPredicate),
    /// A predicate over request context fields.
    Field(FieldPredicate),
}

/// A predicate matching on detector findings (doc 01 §4.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectorPredicate {
    /// Detector id (e.g. `"secret.aws_access_key"`) or `"classification"`/`"sourcecode"`.
    pub detector: String,
    /// The comparison operator.
    pub op: DetectorOp,
    /// Count threshold for `count_gte`.
    #[serde(default)]
    pub min_count: Option<u32>,
    /// Operand for `language_in` (array) / `at_least` (classification string).
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

/// Detector predicate operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectorOp {
    /// At least one finding for this detector.
    Found,
    /// No findings for this detector.
    NotFound,
    /// Finding count `>= min_count`.
    CountGte,
    /// Detected language is in `value`.
    LanguageIn,
    /// Derived classification is at least `value`.
    AtLeast,
}

/// A predicate matching on `ScanInput` context fields (doc 01 §4.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldPredicate {
    /// Field path (e.g. `"provider"`, `"repo.classification"`, `"input.bytes"`).
    pub field: String,
    /// The comparison operator.
    pub op: FieldOp,
    /// Operand value.
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

/// Field predicate operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldOp {
    /// Equals.
    Eq,
    /// Not equals.
    Ne,
    /// Member of the operand array.
    In,
    /// Not a member of the operand array.
    NotIn,
    /// Matches the operand regex.
    Matches,
    /// Numeric greater-than-or-equal.
    Gte,
    /// Numeric less-than-or-equal.
    Lte,
}

impl PolicyBundle {
    /// True when the bundle carries a signature block.
    #[must_use]
    pub fn is_signed(&self) -> bool {
        self.signature.is_some()
    }
}
