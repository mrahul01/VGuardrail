//! The deterministic policy evaluator (doc 01 §5).
//!
//! Pure: given the same `(bundle, input, facts, now_ms)` it returns the same
//! [`RuleDecision`]. Exceptions are applied first (suppress only), then rules are
//! matched and the winner chosen by precedence `block > warn > allow`, then
//! severity, then priority, then rule id.

use pe_core::{Action, Classification, ScanInput, Severity, Suppression};
use serde_json::Value;

use crate::model::{
    Condition, DetectorOp, DetectorPredicate, Exception, FieldOp, FieldPredicate, PolicyBundle,
    Rule, SubjectKind,
};
use crate::regexcache::cached;

/// Facts the engine derives (from detectors + classifier + device state) and
/// feeds to the evaluator. Keeps `pe-dsl` decoupled from `pe-detectors`.
#[derive(Debug, Clone, Default)]
pub struct EvalFacts {
    /// All findings produced for the input.
    pub findings: Vec<pe_core::Finding>,
    /// Languages the source-code detector recognised.
    pub languages: Vec<String>,
    /// Derived data classification of the content.
    pub classification: Classification,
    /// This device's id (for `subject.kind = "device"` exceptions).
    pub device_id: Option<String>,
}

/// The rule-level outcome of evaluation. The engine combines this with findings,
/// risk, and classification to build the wire [`pe_core::Decision`].
#[derive(Debug, Clone, PartialEq)]
pub struct RuleDecision {
    /// Enforcement action.
    pub action: Action,
    /// Winning rule id, or `None` when the tenant default fired.
    pub matched_rule_id: Option<String>,
    /// Winning rule severity, if any.
    pub severity: Option<Severity>,
    /// Exceptions that suppressed a would-have-fired rule.
    pub suppressions: Vec<Suppression>,
    /// Human-readable trace.
    pub reason: String,
}

/// Evaluates `bundle` for `input` given `facts` at time `now_ms` (Unix millis).
#[must_use]
pub fn evaluate(
    bundle: &PolicyBundle,
    input: &ScanInput<'_>,
    facts: &EvalFacts,
    now_ms: i64,
) -> RuleDecision {
    // 1. Resolve active exceptions → map of suppressed rule_id -> exception_id.
    let mut suppress: Vec<(String, String)> = Vec::new();
    for exc in &bundle.exceptions {
        if exc.expires_at > now_ms && subject_matches(exc, input, facts) {
            suppress.push((exc.rule_id.clone(), exc.exception_id.clone()));
        }
    }

    // 2. Collect candidate rules, recording any exception suppression.
    let mut candidates: Vec<&Rule> = Vec::new();
    let mut suppressions: Vec<Suppression> = Vec::new();
    for rule in bundle.rules.iter().filter(|r| r.enabled) {
        if !condition_matches(&rule.match_, input, facts, rule.min_confidence) {
            continue;
        }
        if let Some((_, exc_id)) = suppress.iter().find(|(rid, _)| rid == &rule.rule_id) {
            suppressions.push(Suppression {
                rule_id: rule.rule_id.clone(),
                exception_id: exc_id.clone(),
            });
            continue; // sanctioned bypass — recorded, not actioned
        }
        candidates.push(rule);
    }

    // 3. No candidate → tenant default_action.
    let Some(winner) = pick_winner(&candidates) else {
        let reason = format!(
            "no rule matched; tenant default_action = {:?}{}",
            bundle.default_action,
            suffix(&suppressions)
        );
        return RuleDecision {
            action: bundle.default_action,
            matched_rule_id: None,
            severity: None,
            suppressions,
            reason,
        };
    };

    let reason = format!(
        "rule '{}' matched → {:?}{}",
        winner.rule_id,
        winner.action,
        suffix(&suppressions)
    );
    RuleDecision {
        action: winner.action,
        matched_rule_id: Some(winner.rule_id.clone()),
        severity: Some(winner.severity),
        suppressions,
        reason,
    }
}

fn suffix(s: &[Suppression]) -> String {
    if s.is_empty() {
        String::new()
    } else {
        format!(" ({} exception(s) applied)", s.len())
    }
}

fn pick_winner<'a>(candidates: &[&'a Rule]) -> Option<&'a Rule> {
    candidates.iter().copied().reduce(|best, r| {
        let key_b = (best.action.rank(), best.severity.rank());
        let key_r = (r.action.rank(), r.severity.rank());
        let better = key_r > key_b
            || (key_r == key_b && r.priority < best.priority)
            || (key_r == key_b && r.priority == best.priority && r.rule_id < best.rule_id);
        if better {
            r
        } else {
            best
        }
    })
}

fn subject_matches(exc: &Exception, input: &ScanInput<'_>, facts: &EvalFacts) -> bool {
    match exc.subject.kind {
        SubjectKind::User => input.context.user.user_id == exc.subject.id,
        SubjectKind::Device => facts.device_id.as_deref() == Some(exc.subject.id.as_str()),
        SubjectKind::Group => input
            .context
            .user
            .groups
            .iter()
            .any(|g| g == &exc.subject.id),
    }
}

fn condition_matches(
    cond: &Condition,
    input: &ScanInput<'_>,
    facts: &EvalFacts,
    min_conf: f32,
) -> bool {
    match cond {
        Condition::All { all } => all
            .iter()
            .all(|c| condition_matches(c, input, facts, min_conf)),
        Condition::Any { any } => any
            .iter()
            .any(|c| condition_matches(c, input, facts, min_conf)),
        Condition::Not { not } => !condition_matches(not, input, facts, min_conf),
        Condition::Detector(p) => detector_pred(p, facts, min_conf),
        Condition::Field(p) => field_pred(p, input),
    }
}

fn detector_pred(p: &DetectorPredicate, facts: &EvalFacts, min_conf: f32) -> bool {
    let count = facts
        .findings
        .iter()
        .filter(|f| f.detector_id == p.detector && f.confidence >= min_conf)
        .count();
    match p.op {
        DetectorOp::Found => count >= 1,
        DetectorOp::NotFound => count == 0,
        DetectorOp::CountGte => count as u32 >= p.min_count.unwrap_or(1),
        DetectorOp::LanguageIn => {
            let allowed = value_str_set(p.value.as_ref());
            facts.languages.iter().any(|l| allowed.contains(l.as_str()))
        }
        DetectorOp::AtLeast => p
            .value
            .as_ref()
            .and_then(|v| serde_json::from_value::<Classification>(v.clone()).ok())
            .map(|threshold| facts.classification >= threshold)
            .unwrap_or(false),
    }
}

fn value_str_set(value: Option<&Value>) -> std::collections::HashSet<&str> {
    value
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// A resolved field value for comparison.
enum FieldVal {
    Str(String),
    Int(i64),
    Bool(bool),
    Absent,
}

fn field_pred(p: &FieldPredicate, input: &ScanInput<'_>) -> bool {
    let lhs = field_value(&p.field, input);
    let rhs = p.value.as_ref();
    match p.op {
        FieldOp::Eq => val_eq(&lhs, rhs),
        FieldOp::Ne => !val_eq(&lhs, rhs),
        FieldOp::In => val_in(&lhs, rhs),
        FieldOp::NotIn => !val_in(&lhs, rhs),
        FieldOp::Matches => match (&lhs, rhs.and_then(Value::as_str)) {
            (FieldVal::Str(s), Some(pat)) => cached(pat).map(|re| re.is_match(s)).unwrap_or(false),
            _ => false,
        },
        FieldOp::Gte => num_cmp(&lhs, rhs, |a, b| a >= b),
        FieldOp::Lte => num_cmp(&lhs, rhs, |a, b| a <= b),
    }
}

fn field_value(field: &str, input: &ScanInput<'_>) -> FieldVal {
    let ctx = &input.context;
    let opt = |o: &Option<String>| o.clone().map_or(FieldVal::Absent, FieldVal::Str);
    match field {
        "provider" => opt(&ctx.provider),
        "model" => opt(&ctx.model),
        "app" => opt(&ctx.app),
        "source" => ctx
            .source
            .map(|s| FieldVal::Str(enum_str(&s)))
            .unwrap_or(FieldVal::Absent),
        "repo.name" => ctx
            .repo
            .as_ref()
            .map_or(FieldVal::Absent, |r| FieldVal::Str(r.name.clone())),
        "repo.classification" => ctx
            .repo
            .as_ref()
            .and_then(|r| r.classification)
            .map(|c| FieldVal::Str(enum_str(&c)))
            .unwrap_or(FieldVal::Absent),
        "file.path" => ctx
            .file
            .as_ref()
            .map_or(FieldVal::Absent, |f| FieldVal::Str(f.path.clone())),
        "file.extension" => ctx
            .file
            .as_ref()
            .and_then(|f| f.extension.clone())
            .map_or(FieldVal::Absent, FieldVal::Str),
        "user.role" => FieldVal::Str(enum_str(&ctx.user.role)),
        "user.user_id" => FieldVal::Str(ctx.user.user_id.clone()),
        "input.bytes" => FieldVal::Int(input.bytes() as i64),
        "input.truncated" => FieldVal::Bool(input.truncated),
        _ => FieldVal::Absent,
    }
}

/// Serializes a `serde`-enum to its snake_case string form.
fn enum_str<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|val| val.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn val_eq(lhs: &FieldVal, rhs: Option<&Value>) -> bool {
    match (lhs, rhs) {
        (FieldVal::Str(s), Some(Value::String(v))) => s == v,
        (FieldVal::Int(i), Some(Value::Number(n))) => n.as_i64() == Some(*i),
        (FieldVal::Bool(b), Some(Value::Bool(v))) => b == v,
        _ => false,
    }
}

fn val_in(lhs: &FieldVal, rhs: Option<&Value>) -> bool {
    match rhs.and_then(Value::as_array) {
        Some(arr) => arr.iter().any(|item| val_eq(lhs, Some(item))),
        None => false,
    }
}

fn num_cmp(lhs: &FieldVal, rhs: Option<&Value>, cmp: impl Fn(i64, i64) -> bool) -> bool {
    match (lhs, rhs.and_then(Value::as_i64)) {
        (FieldVal::Int(a), Some(b)) => cmp(*a, b),
        _ => false,
    }
}
