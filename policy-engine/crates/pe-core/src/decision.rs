//! The [`Decision`] produced by policy evaluation.

use serde::{Deserialize, Serialize};

use crate::enums::{Action, Category, Classification, RiskLevel, Severity};
use crate::finding::Finding;

/// Records that a rule which would otherwise have fired was suppressed by an
/// active exception (doc 01 §4a). Retained for audit so a bypass is never silent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Suppression {
    /// The rule that was suppressed.
    pub rule_id: String,
    /// The exception that suppressed it.
    pub exception_id: String,
}

/// The outcome of evaluating a [`crate::ScanInput`] against a policy.
///
/// Pure data — the evaluator in `pe-dsl` produces it, the engine enriches it with
/// timing, and `pe-grpc` maps it onto the wire response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    /// The enforcement action.
    pub action: Action,
    /// The winning rule id, or `None` when the tenant default fired.
    pub matched_rule_id: Option<String>,
    /// Severity of the winning rule (if any).
    pub severity: Option<Severity>,
    /// Aggregate risk level.
    pub risk_level: RiskLevel,
    /// Derived data classification of the content.
    pub classification: Classification,
    /// The primary policy category driving this decision: the category of the
    /// highest-severity finding (first wins on ties), or `None` with no findings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<Category>,
    /// Redacted findings supporting the decision.
    pub findings: Vec<Finding>,
    /// Exceptions applied during this evaluation.
    pub suppressions: Vec<Suppression>,
    /// Human-readable explanation/trace of the decision.
    pub reason: String,
    /// Policy version used for the decision.
    pub policy_version: u32,
    /// True when the detector budget was exhausted and the scan was partial
    /// (doc 00 P-06). Such decisions floor risk at `Medium`.
    pub incomplete: bool,
}

impl Decision {
    /// Builds the decision used when no rule matches: the tenant
    /// `default_action` with an empty finding set.
    #[must_use]
    pub fn default_action(action: Action, policy_version: u32) -> Self {
        Self {
            action,
            matched_rule_id: None,
            severity: None,
            risk_level: RiskLevel::Low,
            classification: Classification::Public,
            category: None,
            findings: Vec::new(),
            suppressions: Vec::new(),
            reason: "no rule matched; tenant default_action applied".to_string(),
            policy_version,
            incomplete: false,
        }
    }

    /// Whether this decision blocks the prompt.
    #[must_use]
    pub fn is_block(&self) -> bool {
        self.action == Action::Block
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_action_decision_has_no_rule() {
        let d = Decision::default_action(Action::Warn, 7);
        assert_eq!(d.action, Action::Warn);
        assert!(d.matched_rule_id.is_none());
        assert_eq!(d.policy_version, 7);
        assert!(!d.is_block());
    }

    #[test]
    fn decision_round_trips_json() {
        let d = Decision::default_action(Action::Block, 1);
        let s = serde_json::to_string(&d).unwrap();
        let back: Decision = serde_json::from_str(&s).unwrap();
        assert_eq!(back, d);
    }
}
