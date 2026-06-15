//! Risk scoring (doc 02 §6): a deterministic, explainable weighted model over
//! findings, bucketed into a [`RiskLevel`].

use pe_core::{Finding, RiskLevel, Severity};

/// Score → bucket thresholds.
const HIGH_THRESHOLD: f64 = 10.0;
const MEDIUM_THRESHOLD: f64 = 3.0;
/// Penalty added when the scan was truncated/incomplete (unknown tail, P-09).
const INCOMPLETE_PENALTY: f64 = 3.0;

/// Computes the aggregate [`RiskLevel`] for a finding set.
///
/// `score = Σ weight(severity) * confidence`, plus a penalty if `incomplete`.
/// Any critical finding forces `Critical`; an incomplete scan floors at `Medium`.
#[must_use]
pub fn score_risk(findings: &[Finding], incomplete: bool) -> RiskLevel {
    let mut score = 0.0;
    let mut has_critical = false;
    for f in findings {
        score += f64::from(f.severity.weight()) * f64::from(f.confidence);
        if f.severity == Severity::Critical {
            has_critical = true;
        }
    }
    if incomplete {
        score += INCOMPLETE_PENALTY;
    }

    let level = if has_critical {
        RiskLevel::Critical
    } else if score >= HIGH_THRESHOLD {
        RiskLevel::High
    } else if score >= MEDIUM_THRESHOLD {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };

    if incomplete {
        level.max(RiskLevel::Medium)
    } else {
        level
    }
}

/// Maps a rule [`Severity`] to the [`RiskLevel`] it floors risk to (doc 02 §6).
#[must_use]
pub fn severity_to_risk(s: Severity) -> RiskLevel {
    match s {
        Severity::Low => RiskLevel::Low,
        Severity::Medium => RiskLevel::Medium,
        Severity::High => RiskLevel::High,
        Severity::Critical => RiskLevel::Critical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::{Category, Span};

    fn finding(sev: Severity, conf: f32) -> Finding {
        Finding::new("d", Category::Secret, "k", Span::new(0, 1), conf, sev, "…")
    }

    #[test]
    fn empty_is_low() {
        assert_eq!(score_risk(&[], false), RiskLevel::Low);
    }

    #[test]
    fn critical_finding_forces_critical() {
        assert_eq!(
            score_risk(&[finding(Severity::Critical, 0.99)], false),
            RiskLevel::Critical
        );
    }

    #[test]
    fn medium_band() {
        // One High finding: weight 7 * 1.0 = 7 → between 3 and 10 → Medium.
        assert_eq!(
            score_risk(&[finding(Severity::High, 1.0)], false),
            RiskLevel::Medium
        );
    }

    #[test]
    fn high_band_from_accumulation() {
        // Two High findings: 14 → High.
        let f = vec![finding(Severity::High, 1.0), finding(Severity::High, 1.0)];
        assert_eq!(score_risk(&f, false), RiskLevel::High);
    }

    #[test]
    fn incomplete_floors_at_medium() {
        assert_eq!(score_risk(&[], true), RiskLevel::Medium);
    }
}
