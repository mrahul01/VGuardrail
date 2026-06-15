//! The engine service: the synchronous evaluation pipeline plus the async gRPC
//! handlers that wrap it.
//!
//! The pipeline (doc 02 §1) is: detectors → classification → risk → DSL
//! evaluation → decision → event enqueue. Core methods ([`EngineService::process`],
//! [`EngineService::load_policy_bytes`], [`EngineService::health_snapshot`]) are
//! synchronous and unit-testable; the tonic trait impl is a thin wrapper.

use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use pe_core::{
    primary_category, Action, Budget, Category, Clock, Decision, Finding, ScanInput, Severity,
    Span,
};
use pe_detectors::{classify_risk, derive_classification, DetectorRegistry, RiskScore};
use pe_dsl::{evaluate, EvalFacts, PolicySet, RuleDecision};
use pe_grpc::{map, pb, PolicyEngine};
use pe_store::{CachedPolicy, Store};
use tonic::{Request, Response, Status};

use crate::code_classifier::CodeClassifier;
use crate::config::EngineConfig;
use crate::event::{build_event, primary_event_type};
use crate::llm::LlmClassifier;
use crate::risk::{score_risk, severity_to_risk};

/// Result of a `LoadPolicy` operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadOutcome {
    /// Whether the bundle was accepted.
    pub accepted: bool,
    /// The active version after the call.
    pub active_version: u32,
    /// Rejection reason when `accepted` is false.
    pub reject_reason: String,
}

/// The policy engine, shared across gRPC handlers.
#[derive(Clone)]
pub struct EngineService {
    registry: Arc<DetectorRegistry>,
    policy: Arc<RwLock<PolicySet>>,
    store: Arc<Mutex<Store>>,
    clock: Arc<dyn Clock>,
    device_id: String,
    config: EngineConfig,
    llm: Option<Arc<LlmClassifier>>,
    code_classifier: Option<Arc<CodeClassifier>>,
}

impl EngineService {
    /// Constructs the service from its collaborators.
    #[must_use]
    pub fn new(
        registry: Arc<DetectorRegistry>,
        policy: Arc<RwLock<PolicySet>>,
        store: Arc<Mutex<Store>>,
        clock: Arc<dyn Clock>,
        device_id: String,
        config: EngineConfig,
    ) -> Self {
        Self {
            registry,
            policy,
            store,
            clock,
            device_id,
            config,
            llm: None,
            code_classifier: None,
        }
    }

    /// Attaches an optional local-LLM classifier used to refine the
    /// AI-classification tier (builder-style; the engine works without one).
    #[must_use]
    pub fn with_llm(mut self, llm: Arc<LlmClassifier>) -> Self {
        self.llm = Some(llm);
        self
    }

    /// Attaches the optional second-stage code classifier (builder-style);
    /// it runs only on inputs the source-code gate already flagged.
    #[must_use]
    pub fn with_code_classifier(mut self, classifier: Arc<CodeClassifier>) -> Self {
        self.code_classifier = Some(classifier);
        self
    }

    /// Runs the full pipeline for `input` and records audit events. Returns the
    /// [`Decision`]. This is the synchronous core used by the gRPC handler and by
    /// tests.
    #[must_use]
    pub fn process(&self, input: &ScanInput<'_>) -> Decision {
        let decision = self.evaluate_input(input);
        self.record_decision(&input.context, &decision);
        decision
    }

    fn evaluate_input(&self, input: &ScanInput<'_>) -> Decision {
        let budget = Budget::from_millis(self.config.budget_ms);
        let mut findings = self.registry.scan_all(input, &budget);
        let incomplete = budget.is_exhausted();
        let languages = self.registry.languages(input);
        let repo_class = input.context.repo.as_ref().and_then(|r| r.classification);
        let classification = derive_classification(&findings, repo_class);
        let mut risk = score_risk(&findings, incomplete);
        let now = self.clock.now_millis();

        // Primary category and the aggregate AI-classification step (category
        // 15). Both look only at the real detector findings; the risk-score
        // finding is appended afterwards so it cannot feed back into either.
        let detector_category = primary_category(&findings);
        let mut risk_score = classify_risk(&findings, incomplete);
        let mut llm_category = None;
        if let Some(llm) = &self.llm {
            let (refined, cat) = llm.refine(input.text, risk_score);
            risk_score = refined;
            llm_category = cat;
        }
        // Second-stage code classifier: only when the source-code gate fired,
        // and its verdict can only raise the tier (Confidential floor).
        let mut code_verdict = None;
        if let Some(classifier) = &self.code_classifier {
            if findings.iter().any(|f| f.category == Category::SourceCode) {
                let (refined, verdict) = classifier.refine(input.text, risk_score);
                risk_score = refined;
                code_verdict = verdict;
            }
        }
        // The LLM category is a fallback only — a detector finding always wins.
        let category = detector_category.or(llm_category);
        findings.push(risk_score_finding(
            risk_score,
            self.llm.is_some(),
            llm_category,
            code_verdict,
        ));

        let facts = EvalFacts {
            findings: findings.clone(),
            languages,
            classification,
            device_id: Some(self.device_id.clone()),
        };

        let guard = self.policy.read().expect("policy lock poisoned");
        let (rule_dec, policy_version) = match guard.current() {
            Some(bundle) => (evaluate(bundle, input, &facts, now), bundle.version),
            None => (
                RuleDecision {
                    action: self.config.bootstrap_action,
                    matched_rule_id: None,
                    severity: None,
                    suppressions: Vec::new(),
                    reason: "no policy loaded; bootstrap default_action applied".to_string(),
                },
                0,
            ),
        };
        drop(guard);

        if let Some(sev) = rule_dec.severity {
            risk = risk.max(severity_to_risk(sev));
        }

        let mut action = rule_dec.action;
        let mut reason = compose_reason(&rule_dec.reason, category, &findings, risk_score);

        // High-critical force block: any critical *detection* overrides an
        // allow/warn outcome (doc 3C). Two carve-outs: the synthetic risk-score
        // finding (it reflects the aggregate, not an individual detection), and
        // evaluations where an active approved exception suppressed a rule —
        // an explicit, time-bounded, audited governance decision outranks the
        // blanket override, otherwise exceptions would be useless for exactly
        // the critical categories they exist to manage.
        if self.config.critical_force_block
            && action != Action::Block
            && rule_dec.suppressions.is_empty()
            && findings.iter().any(|f| {
                f.severity == Severity::Critical && f.detector_id != "ai_classification.risk_score"
            })
        {
            action = Action::Block;
            reason.push_str(" | critical finding: force-block override");
        }

        Decision {
            action,
            matched_rule_id: rule_dec.matched_rule_id,
            severity: rule_dec.severity,
            risk_level: risk,
            classification,
            category,
            findings,
            suppressions: rule_dec.suppressions,
            reason,
            policy_version,
            incomplete,
        }
    }

    fn record_decision(&self, ctx: &pe_core::ScanContext, decision: &Decision) {
        let mut events = vec![build_event(
            "PolicyEvaluated",
            decision,
            ctx,
            self.clock.as_ref(),
            &self.config.event_signing_key,
        )];
        // A warn/block on a matched rule is also a violation (doc 04 §2).
        if decision.matched_rule_id.is_some() && decision.action != pe_core::Action::Allow {
            events.push(build_event(
                primary_event_type(decision),
                decision,
                ctx,
                self.clock.as_ref(),
                &self.config.event_signing_key,
            ));
        }
        if let Ok(store) = self.store.lock() {
            for e in &events {
                if let Err(err) = store.enqueue(e) {
                    tracing::warn!(error = %err, "failed to enqueue audit event");
                }
            }
        }
    }

    /// Validates and installs a signed policy bundle, persisting it to the cache.
    /// Fail-closed: on rejection the active policy is unchanged.
    #[must_use]
    pub fn load_policy_bytes(&self, bundle_json: &[u8]) -> LoadOutcome {
        let mut guard = self.policy.write().expect("policy lock poisoned");
        match guard.load(bundle_json) {
            Ok(result) => {
                // Persist the now-active bundle to the local cache.
                if let Some(bundle) = guard.current() {
                    let cached = CachedPolicy {
                        version: bundle.version,
                        bundle_json: bundle_json.to_vec(),
                        signature: bundle
                            .signature
                            .as_ref()
                            .map(|s| s.value.clone())
                            .unwrap_or_default(),
                        key_id: bundle
                            .signature
                            .as_ref()
                            .map(|s| s.key_id.clone())
                            .unwrap_or_default(),
                        is_active: true,
                    };
                    let now = self.clock.now_millis().to_string();
                    if let Ok(mut store) = self.store.lock() {
                        let _ = store.install_policy(&cached, &bundle.created_at, &now, true);
                        let _ = store.prune_policies(3); // keep current/previous/lkg
                    }
                }
                LoadOutcome {
                    accepted: true,
                    active_version: result.active_version,
                    reject_reason: String::new(),
                }
            }
            Err(e) => LoadOutcome {
                accepted: false,
                active_version: guard.active_version(),
                reject_reason: e.to_string(),
            },
        }
    }

    /// Returns `(active_policy_version, queued_events)` for health reporting.
    #[must_use]
    pub fn health_snapshot(&self) -> (u32, u64) {
        let version = self.policy.read().map(|g| g.active_version()).unwrap_or(0);
        let depth = self
            .store
            .lock()
            .ok()
            .and_then(|s| s.queue_depth().ok())
            .unwrap_or(0);
        (version, depth)
    }
}

/// Builds the synthetic `ai_classification` finding carrying the aggregate
/// risk score (span is empty: the score describes the whole prompt).
fn risk_score_finding(
    score: RiskScore,
    llm_assisted: bool,
    llm_category: Option<Category>,
    code_verdict: Option<(String, f64)>,
) -> Finding {
    let mut finding = Finding::new(
        "ai_classification.risk_score",
        Category::AiClassification,
        "risk_score",
        Span::new(0, 0),
        1.0,
        score.tier.severity(),
        format!("risk {}/100 ({})", score.score, score.tier.as_str()),
    )
    .with_meta("score", score.score.to_string())
    .with_meta("tier", score.tier.as_str())
    .with_meta("llm_assisted", llm_assisted.to_string());
    if let Some(category) = llm_category {
        finding = finding.with_meta("llm_category", category.wire_name());
    }
    if let Some((label, score)) = code_verdict {
        finding = finding
            .with_meta("code_classifier", label)
            .with_meta("code_classifier_score", format!("{score:.2}"));
    }
    finding
}

/// Composes the human-readable decision reason: the rule/default explanation,
/// the primary category, a short finding summary, and the risk score.
fn compose_reason(
    base: &str,
    category: Option<Category>,
    findings: &[Finding],
    risk_score: RiskScore,
) -> String {
    let Some(category) = category else {
        return format!("{base} | risk_score={}/100 ({})", risk_score.score, risk_score.tier.as_str());
    };
    // Summarise the top kinds (excluding the synthetic risk-score entry).
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for f in findings.iter().filter(|f| f.kind != "risk_score") {
        match counts.iter_mut().find(|(k, _)| *k == f.kind.as_str()) {
            Some((_, n)) => *n += 1,
            None => counts.push((f.kind.as_str(), 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    let summary: Vec<String> = counts
        .iter()
        .take(3)
        .map(|(k, n)| if *n > 1 { format!("{k} ×{n}") } else { (*k).to_string() })
        .collect();
    format!(
        "{base} | category={}; detected: {}; risk_score={}/100 ({})",
        category.wire_name(),
        summary.join(", "),
        risk_score.score,
        risk_score.tier.as_str()
    )
}

#[tonic::async_trait]
impl PolicyEngine for EngineService {
    async fn evaluate(
        &self,
        request: Request<pb::EvaluateRequest>,
    ) -> Result<Response<pb::EvaluateResponse>, Status> {
        let req = request.into_inner();
        let ctx = map::scan_context_from_pb(req.context);
        let input = ScanInput::new(&req.text, ctx);

        let start = Instant::now();
        let decision = self.process(&input);
        let elapsed = u32::try_from(start.elapsed().as_micros()).unwrap_or(u32::MAX);

        Ok(Response::new(map::evaluate_response(
            req.request_id,
            &decision,
            elapsed,
        )))
    }

    async fn load_policy(
        &self,
        request: Request<pb::LoadPolicyRequest>,
    ) -> Result<Response<pb::LoadPolicyResponse>, Status> {
        let outcome = self.load_policy_bytes(&request.into_inner().bundle_json);
        Ok(Response::new(pb::LoadPolicyResponse {
            accepted: outcome.accepted,
            active_version: outcome.active_version,
            reject_reason: outcome.reject_reason,
        }))
    }

    async fn health(
        &self,
        _request: Request<pb::HealthRequest>,
    ) -> Result<Response<pb::HealthResponse>, Status> {
        let (version, queued) = self.health_snapshot();
        Ok(Response::new(pb::HealthResponse {
            status: pb::ServingStatus::Serving as i32,
            active_policy_version: version,
            queued_events: queued,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
        }))
    }
}
