//! AI classification (category 15 of 15): the final aggregate step that turns
//! a finding set into a 0–100 risk score and one of five risk tiers. Like
//! [`crate::derive_classification`] it is a pure function over detector output;
//! the engine appends its result as a synthetic `ai_classification` finding and
//! may refine it with a local LLM (pe-engine's `llm` module).

use pe_core::{Finding, Severity};

/// The five AI-classification risk tiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskTier {
    /// 0–9: no meaningful signal.
    Safe,
    /// 10–29: weak signal.
    Low,
    /// 30–59: sensitive content likely.
    Sensitive,
    /// 60–84: confidential content likely.
    Confidential,
    /// 85–100: restricted content (secrets / regulated data).
    Restricted,
}

impl RiskTier {
    /// Stable snake_case name for wire/meta use.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            RiskTier::Safe => "safe",
            RiskTier::Low => "low",
            RiskTier::Sensitive => "sensitive",
            RiskTier::Confidential => "confidential",
            RiskTier::Restricted => "restricted",
        }
    }

    /// The severity a synthetic `ai_classification` finding carries.
    #[must_use]
    pub const fn severity(self) -> Severity {
        match self {
            RiskTier::Safe | RiskTier::Low => Severity::Low,
            RiskTier::Sensitive => Severity::Medium,
            RiskTier::Confidential => Severity::High,
            RiskTier::Restricted => Severity::Critical,
        }
    }
}

/// A 0–100 risk score with its tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RiskScore {
    /// Aggregate score in `[0, 100]`.
    pub score: u8,
    /// The tier the score falls into.
    pub tier: RiskTier,
}

/// Scale factor mapping the additive severity-weight model (doc 02 §6) onto
/// the 0–100 band: one critical finding at full confidence (weight 15) lands
/// at 90 (Restricted); one medium finding lands at 18 (Low).
const SCALE: f64 = 6.0;
/// Raw-weight penalty for a truncated/incomplete scan (unknown tail); lands an
/// otherwise-clean prompt in the `Low` tier (18 points) rather than `Safe`.
const INCOMPLETE_PENALTY: f64 = 3.0;

/// Computes the aggregate risk score for a finding set.
#[must_use]
pub fn classify_risk(findings: &[Finding], incomplete: bool) -> RiskScore {
    let mut raw: f64 = findings
        .iter()
        .map(|f| f64::from(f.severity.weight()) * f64::from(f.confidence))
        .sum();
    if incomplete {
        raw += INCOMPLETE_PENALTY;
    }
    let score = (raw * SCALE).round().clamp(0.0, 100.0) as u8;
    let tier = match score {
        0..=9 => RiskTier::Safe,
        10..=29 => RiskTier::Low,
        30..=59 => RiskTier::Sensitive,
        60..=84 => RiskTier::Confidential,
        _ => RiskTier::Restricted,
    };
    RiskScore { score, tier }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::{Category, Span};

    fn finding(sev: Severity, conf: f32) -> Finding {
        Finding::new("d", Category::Secret, "k", Span::new(0, 1), conf, sev, "…")
    }

    #[test]
    fn empty_is_safe() {
        let r = classify_risk(&[], false);
        assert_eq!(r.score, 0);
        assert_eq!(r.tier, RiskTier::Safe);
    }

    #[test]
    fn critical_secret_is_restricted() {
        let r = classify_risk(&[finding(Severity::Critical, 0.99)], false);
        assert!(r.score >= 85, "score {} should be Restricted", r.score);
        assert_eq!(r.tier, RiskTier::Restricted);
        assert_eq!(r.tier.severity(), Severity::Critical);
    }

    #[test]
    fn single_medium_is_low_tier() {
        let r = classify_risk(&[finding(Severity::Medium, 1.0)], false);
        assert_eq!(r.tier, RiskTier::Low);
    }

    #[test]
    fn accumulation_reaches_confidential() {
        let f = vec![finding(Severity::High, 1.0), finding(Severity::High, 1.0)];
        let r = classify_risk(&f, false);
        assert_eq!(r.tier, RiskTier::Confidential);
    }

    #[test]
    fn score_is_clamped_at_100() {
        let f: Vec<Finding> = (0..10).map(|_| finding(Severity::Critical, 1.0)).collect();
        assert_eq!(classify_risk(&f, false).score, 100);
    }

    #[test]
    fn incomplete_adds_penalty() {
        let r = classify_risk(&[], true);
        assert!(r.score >= 10 && r.tier == RiskTier::Low);
    }
}
