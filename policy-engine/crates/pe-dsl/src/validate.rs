//! Static validation of a parsed bundle (doc 01 §6). All checks are fail-closed:
//! any failure aborts the load and the engine keeps its last-good policy.

use std::collections::HashSet;

use crate::error::PolicyError;
use crate::model::{Condition, DetectorOp, FieldPredicate, PolicyBundle, Rule, SUPPORTED_SCHEMAS};
use crate::regexcache::compile_checked;

/// The fixed set of context fields a [`FieldPredicate`] may address (doc 01 §4.2).
pub const KNOWN_FIELDS: &[&str] = &[
    "provider",
    "source",
    "model",
    "app",
    "repo.name",
    "repo.classification",
    "file.path",
    "file.extension",
    "user.role",
    "user.user_id",
    "input.bytes",
    "input.truncated",
];

/// Validates a bundle against the engine's known detector ids.
///
/// `known_detectors` is supplied by the engine from its registry so the DSL crate
/// stays decoupled from `pe-detectors`.
///
/// # Errors
/// Returns the first [`PolicyError`] encountered.
pub fn validate_bundle(
    bundle: &PolicyBundle,
    known_detectors: &HashSet<String>,
) -> Result<(), PolicyError> {
    if !SUPPORTED_SCHEMAS.contains(&bundle.schema.as_str()) {
        return Err(PolicyError::UnsupportedSchema {
            expected: SUPPORTED_SCHEMAS.to_vec(),
            got: bundle.schema.clone(),
        });
    }

    for exc in &bundle.exceptions {
        if exc.expires_at <= 0 {
            return Err(PolicyError::Invalid(format!(
                "exception '{}' must have a positive expires_at (no perpetual bypass)",
                exc.exception_id
            )));
        }
        if exc.approved_by.trim().is_empty() {
            return Err(PolicyError::Invalid(format!(
                "exception '{}' must record approved_by",
                exc.exception_id
            )));
        }
    }

    let known_fields: HashSet<&str> = KNOWN_FIELDS.iter().copied().collect();
    for rule in &bundle.rules {
        validate_rule(rule, known_detectors, &known_fields)?;
    }
    Ok(())
}

fn validate_rule(
    rule: &Rule,
    known_detectors: &HashSet<String>,
    known_fields: &HashSet<&str>,
) -> Result<(), PolicyError> {
    if !(0.0..=1.0).contains(&rule.min_confidence) {
        return Err(PolicyError::Invalid(format!(
            "rule '{}' min_confidence {} out of [0,1]",
            rule.rule_id, rule.min_confidence
        )));
    }
    validate_condition(&rule.match_, rule, known_detectors, known_fields)
}

fn validate_condition(
    cond: &Condition,
    rule: &Rule,
    known_detectors: &HashSet<String>,
    known_fields: &HashSet<&str>,
) -> Result<(), PolicyError> {
    match cond {
        Condition::All { all } => {
            for c in all {
                validate_condition(c, rule, known_detectors, known_fields)?;
            }
            Ok(())
        }
        Condition::Any { any } => {
            for c in any {
                validate_condition(c, rule, known_detectors, known_fields)?;
            }
            Ok(())
        }
        Condition::Not { not } => validate_condition(not, rule, known_detectors, known_fields),
        Condition::Detector(p) => {
            // "classification" and "sourcecode" are virtual detector ids handled
            // specially by the evaluator; everything else must be registered.
            let virtual_ids = matches!(p.detector.as_str(), "classification" | "sourcecode");
            if !virtual_ids && !known_detectors.contains(&p.detector) {
                return Err(PolicyError::UnknownDetector {
                    rule_id: rule.rule_id.clone(),
                    detector: p.detector.clone(),
                });
            }
            if p.op == DetectorOp::CountGte && p.min_count.is_none() {
                return Err(PolicyError::Invalid(format!(
                    "rule '{}' uses count_gte without min_count",
                    rule.rule_id
                )));
            }
            Ok(())
        }
        Condition::Field(p) => validate_field_predicate(p, rule, known_fields),
    }
}

fn validate_field_predicate(
    p: &FieldPredicate,
    rule: &Rule,
    known_fields: &HashSet<&str>,
) -> Result<(), PolicyError> {
    if !known_fields.contains(p.field.as_str()) {
        return Err(PolicyError::UnknownField {
            rule_id: rule.rule_id.clone(),
            field: p.field.clone(),
        });
    }
    // Pre-compile regex operands so a bad pattern fails at load, not at runtime.
    if matches!(p.op, crate::model::FieldOp::Matches) {
        let pattern = p
            .value
            .as_ref()
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                PolicyError::Invalid(format!(
                    "rule '{}' matches predicate needs a string value",
                    rule.rule_id
                ))
            })?;
        compile_checked(pattern).map_err(|source| PolicyError::InvalidRegex {
            rule_id: rule.rule_id.clone(),
            pattern: pattern.to_string(),
            source,
        })?;
    }
    Ok(())
}
