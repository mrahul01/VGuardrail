//! `POST /scan` — prompt evaluation endpoint for the Chrome extension (HTTP fallback).
//!
//! In local dev mode (`VG_DEV_CLAIMS=1`) this accepts a prompt text + context,
//! runs a simple pattern-based check, and returns a `Decision` compatible with
//! the extension's Decision contract.  Audit events are recorded so they appear
//! in the dashboard.
//!
//! No device registration required — the extension registers on the fly using the
//! dev token `local-dev-token` (or any token when VG_DEV_CLAIMS=1).

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::error::ApiErrorResponse;
use crate::routes::admin_audit::{record_dev_audit, DevAuditEvent};
use crate::state::AppState;

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

pub fn router(state: AppState) -> axum::Router<AppState> {
    axum::Router::new()
        .route("/scan", axum::routing::post(handle_scan))
        .with_state(state)
}

// -----------------------------------------------------------------------------
// Request / Response types (mirror the extension protocol)
// -----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    pub text: String,
    #[serde(default)]
    pub context: ScanContext,
    /// Optional file attachments to scan alongside the prompt text. Each file's
    /// content is base64-encoded; the server extracts text per its tier (text /
    /// PDF·Office·archive) and folds the result into the same evaluation.
    #[serde(default)]
    pub files: Vec<ScanFile>,
}

/// A base64-encoded file attached to a scan request.
#[derive(Debug, Deserialize)]
pub struct ScanFile {
    /// File name (used for extension-based tier hints and audit, never trusted alone).
    pub name: String,
    /// Optional declared MIME type hint.
    #[serde(default)]
    pub mime: Option<String>,
    /// Standard base64-encoded file bytes.
    pub content_base64: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct ScanContext {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub app: Option<String>,
}

/// Decision shape returned to the extension.
/// Matches `browser-connectors/chrome/extension/src/shared/contract.ts`.
#[derive(Debug, Serialize)]
pub struct Decision {
    pub request_id: String,
    pub action: String,
    pub risk_level: String,
    /// Aggregate risk score in `[0, 100]` (drives the connectors' Send-Anyway gate).
    pub risk_score: u8,
    /// Strongest single-finding confidence as a percentage in `[0, 100]`.
    pub confidence: u8,
    pub matched_rule_id: Option<String>,
    pub severity: Option<String>,
    pub findings: Vec<Finding>,
    pub reason: String,
    /// "complete" when every attached file was scanned within the latency cap,
    /// or "pending" when one or more deep (Tier 2/3) extractions were deferred
    /// to a background task (whose result lands in the audit trail).
    pub scan_status: String,
    /// Set to the request id when `scan_status` is "pending" (poll-able).
    pub pending_scan_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub detector_id: String,
    pub category: String,
    pub kind: String,
    pub severity: String,
    pub redacted_preview: String,
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

async fn handle_scan(
    State(_state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ScanRequest>,
) -> Result<impl IntoResponse, ApiErrorResponse> {
    let dev_mode = std::env::var("VG_DEV_CLAIMS").is_ok();

    // Determine device identity
    let device_id = if dev_mode {
        headers
            .get("x-device-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("ext-device-unknown")
            .to_string()
    } else {
        // In production, extract from the device JWT
        "ext-device-unknown".to_string()
    };

    let org_id = if dev_mode {
        headers
            .get("x-vg-org-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("local-org")
            .to_string()
    } else {
        "local-org".to_string()
    };

    let request_id = format!("scan-{}", uuid::Uuid::new_v4());

    // ── Tier 1–3 file extraction (hybrid: sync within the latency cap) ──
    // Decode + classify attached files, extract text from Tier-1/2 files, and
    // fold it into the same evaluation. Tier-2 extractions that exceed the cap
    // are deferred to a background task that audits any violation.
    let file_outcome = process_files(&req.files).await;
    let any_pending = !file_outcome.deferred.is_empty();
    let combined_text = if file_outcome.extra_text.is_empty() {
        req.text.clone()
    } else {
        format!("{}\n{}", req.text, file_outcome.extra_text)
    };

    // ── Run the real detector pipeline over prompt + extracted file text ──
    let PromptEval {
        action,
        risk_level,
        findings,
        reason,
        risk_score,
        confidence,
    } = evaluate_prompt(&combined_text);

    let decision = Decision {
        request_id: request_id.clone(),
        action: action.clone(),
        risk_level: risk_level.clone(),
        risk_score,
        confidence,
        matched_rule_id: if action == "allow" { None } else { Some("dev-local-policy-v1".to_string()) },
        severity: if action == "block" { Some("high".to_string()) } else { None },
        findings: findings.clone(),
        reason: reason.clone(),
        scan_status: if any_pending { "pending".to_string() } else { "complete".to_string() },
        pending_scan_id: if any_pending { Some(request_id.clone()) } else { None },
    };

    // Deferred (over-cap) Tier-2 files finish + audit in the background.
    spawn_deferred_file_scans(file_outcome.deferred, &request_id, &org_id, &device_id);

    // ── Record audit event (so it shows up in dashboard) ────────────────
    let event_id = format!("evt-{}", uuid::Uuid::new_v4());
    let now_ms = chrono::Utc::now().timestamp_millis();

    let details = serde_json::json!({
        "prompt_length": req.text.len(),
        "action": action,
        "risk_level": risk_level,
        "matched_rule_id": decision.matched_rule_id,
        "findings": findings.iter().map(|f| serde_json::json!({
            "detector_id": f.detector_id,
            "category": f.category,
            "kind": f.kind,
            "severity": f.severity,
        })).collect::<Vec<_>>(),
        "files": file_outcome.file_meta,
        "scan_status": decision.scan_status,
        "context": {
            "provider": req.context.provider,
            "model": req.context.model,
            "url": req.context.url,
        },
    });

    // Record the audit event in the in-memory store so the dashboard can
    // query it via GET /admin/audit
    record_dev_audit(DevAuditEvent {
        event_id,
        org_id: org_id.clone(),
        device_id: device_id.clone(),
        timestamp_ms: now_ms,
        event_type: "prompt_scan".to_string(),
        severity: risk_level.clone(),
        action: action.clone(),
        risk_level: risk_level.clone(),
        category: dominant_category(&findings),
        reason: Some(reason.clone()),
        details,
    });

    info!(
        scan_request_id = %request_id,
        org_id = %org_id,
        device_id = %device_id,
        action = %action,
        prompt_length = req.text.len(),
        "scan evaluated"
    );

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "request_id": request_id,
            "decision": decision,
        })),
    ))
}

/// The category of the highest-severity finding (first wins on ties), used as
/// the event-level category — mirrors `AuditEvent::effective_category`.
fn dominant_category(findings: &[Finding]) -> Option<String> {
    fn rank(severity: &str) -> u8 {
        match severity {
            "critical" => 4,
            "high" => 3,
            "medium" => 2,
            _ => 1,
        }
    }
    findings
        .iter()
        .reduce(|best, f| {
            if rank(&f.severity) > rank(&best.severity) {
                f
            } else {
                best
            }
        })
        .map(|f| f.category.clone())
}

// -----------------------------------------------------------------------------
// File extraction (multi-tier, hybrid latency cap)
// -----------------------------------------------------------------------------

use base64::Engine as _;
use crate::extract::{self, ExtractError, Tier, MAX_FILE_BYTES};

const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The synchronous latency cap for deep (Tier-2) extraction, in milliseconds.
/// Extractions exceeding it are deferred to a background task. `VG_FILE_SCAN_CAP_MS`.
fn file_scan_cap() -> std::time::Duration {
    let ms = std::env::var("VG_FILE_SCAN_CAP_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(800);
    std::time::Duration::from_millis(ms)
}

/// A Tier-2 extraction that exceeded the cap and is finishing in the background.
struct DeferredFile {
    name: String,
    handle: tokio::task::JoinHandle<Result<String, ExtractError>>,
}

/// Result of processing a request's file attachments within the latency cap.
struct FileScanOutcome {
    /// Concatenated extracted text from files that completed within the cap.
    extra_text: String,
    /// Per-file metadata for the audit trail (never raw content).
    file_meta: Vec<serde_json::Value>,
    /// Tier-2 files still extracting past the cap.
    deferred: Vec<DeferredFile>,
}

/// Decodes + classifies attachments, extracting Tier-1 (text) inline and
/// running Tier-2 (PDF/Office/archive) extraction concurrently under a shared
/// deadline. Tier-3 (image/binary) is not extracted here — that is the agent's
/// OCR job; only its presence is noted.
async fn process_files(files: &[ScanFile]) -> FileScanOutcome {
    let mut extra_text = String::new();
    let mut file_meta = Vec::new();
    let mut pending: Vec<(String, tokio::task::JoinHandle<Result<String, ExtractError>>)> = Vec::new();

    for f in files {
        let bytes = match B64.decode(f.content_base64.trim().as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                file_meta.push(serde_json::json!({ "name": f.name, "error": "invalid base64" }));
                continue;
            }
        };
        if bytes.len() > MAX_FILE_BYTES {
            file_meta.push(serde_json::json!({
                "name": f.name, "tier": "skipped", "reason": "exceeds size cap", "bytes": bytes.len(),
            }));
            continue;
        }

        match extract::mime::classify(&f.name, f.mime.as_deref(), &bytes) {
            Tier::Text => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                file_meta.push(serde_json::json!({
                    "name": f.name, "tier": "text", "extracted_chars": text.len(),
                }));
                extra_text.push('\n');
                extra_text.push_str(&text);
            }
            Tier::Structured => {
                let name = f.name.clone();
                let mime = f.mime.clone();
                let handle = tokio::task::spawn_blocking(move || {
                    extract::extract_text(&name, mime.as_deref(), &bytes)
                });
                pending.push((f.name.clone(), handle));
            }
            Tier::Binary => {
                file_meta.push(serde_json::json!({
                    "name": f.name, "tier": "binary",
                    "note": "image/binary not extracted server-side (OCR runs in the agent)",
                }));
            }
        }
    }

    // Await structured extractions against one shared deadline so the total
    // wall-clock stays within the cap regardless of file count.
    let deadline = tokio::time::Instant::now() + file_scan_cap();
    let mut deferred = Vec::new();
    for (name, mut handle) in pending {
        // Pass `&mut handle` (JoinHandle is Unpin + Future) so the handle is
        // still owned if the extraction exceeds the deadline and we defer it.
        match tokio::time::timeout_at(deadline, &mut handle).await {
            Ok(Ok(Ok(text))) => {
                file_meta.push(serde_json::json!({
                    "name": name, "tier": "structured", "extracted_chars": text.len(),
                }));
                extra_text.push('\n');
                extra_text.push_str(&text);
            }
            Ok(Ok(Err(e))) => {
                file_meta.push(serde_json::json!({
                    "name": name, "tier": "structured", "error": e.to_string(),
                }));
            }
            Ok(Err(_join)) => {
                file_meta.push(serde_json::json!({
                    "name": name, "tier": "structured", "error": "extraction task failed",
                }));
            }
            Err(_elapsed) => {
                file_meta.push(serde_json::json!({
                    "name": name.clone(), "tier": "structured", "status": "pending",
                }));
                deferred.push(DeferredFile { name, handle });
            }
        }
    }

    FileScanOutcome { extra_text, file_meta, deferred }
}

/// Spawns background tasks for over-cap Tier-2 files: each awaits its extraction
/// then, if the extracted text trips policy, appends a `file_scan_violation`
/// audit event linked to the parent scan (detection, since the response already
/// returned).
fn spawn_deferred_file_scans(
    deferred: Vec<DeferredFile>,
    parent_request_id: &str,
    org_id: &str,
    device_id: &str,
) {
    for DeferredFile { name, handle } in deferred {
        let parent = parent_request_id.to_string();
        let org = org_id.to_string();
        let device = device_id.to_string();
        tokio::spawn(async move {
            let text = match handle.await {
                Ok(Ok(t)) => t,
                _ => return,
            };
            if text.trim().is_empty() {
                return;
            }
            let eval = evaluate_prompt(&text);
            if eval.action == "allow" {
                return;
            }
            record_dev_audit(DevAuditEvent {
                event_id: format!("evt-{}", uuid::Uuid::new_v4()),
                org_id: org,
                device_id: device,
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                event_type: "file_scan_violation".to_string(),
                severity: eval.risk_level.clone(),
                action: eval.action.clone(),
                risk_level: eval.risk_level.clone(),
                category: dominant_category(&eval.findings),
                reason: Some(format!("Deferred file scan flagged {name}: {}", eval.reason)),
                details: serde_json::json!({
                    "parent_request_id": parent,
                    "file": name,
                    "tier": "structured",
                    "deferred": true,
                    "findings": eval.findings.iter().map(|f| serde_json::json!({
                        "detector_id": f.detector_id,
                        "category": f.category,
                        "kind": f.kind,
                        "severity": f.severity,
                    })).collect::<Vec<_>>(),
                }),
            });
        });
    }
}

// -----------------------------------------------------------------------------
// Real policy-engine evaluation
// -----------------------------------------------------------------------------
//
// The dev `/scan` endpoint runs the SAME detector set as the production engine
// (all 24 categories: secrets, PII, source/config, financial, legal, medical,
// HR, security, R&D, communication, procurement, government, destructive
// commands, prompt injection, …) plus the optional Granite Guardian LLM when
// `VG_LLM_ENDPOINT` is set. It is the in-process detection pipeline, not the
// gRPC engine: no signed policy bundle is required, so the action is derived
// directly from finding severity + the aggregate risk tier.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, ScanInput, Severity};
use pe_detectors::{classify_risk, DetectorConfig, DetectorRegistry, RiskTier};
use pe_engine::{LlmClassifier, LlmConfig};

/// Built once: the detector registry honours `VG_DETECTOR_CONFIG`, and the
/// Granite Guardian classifier is attached when `VG_LLM_ENDPOINT` is set.
static ENGINE: Lazy<DevEngine> = Lazy::new(DevEngine::from_env);

struct DevEngine {
    registry: DetectorRegistry,
    llm: Option<LlmClassifier>,
}

impl DevEngine {
    fn from_env() -> Self {
        let config = std::env::var("VG_DETECTOR_CONFIG")
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|raw| serde_yaml::from_str::<DetectorConfig>(&raw).ok())
            .unwrap_or_default();
        let registry =
            DetectorRegistry::from_config(&config).unwrap_or_else(|_| DetectorRegistry::default_set());
        let llm = LlmConfig::from_env().map(LlmClassifier::new);
        if llm.is_some() {
            info!("scan: Granite Guardian LLM classification enabled");
        }
        Self { registry, llm }
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Low => "low",
        Severity::Medium => "medium",
        Severity::High => "high",
        Severity::Critical => "critical",
    }
}

/// The outcome of evaluating a prompt: the action/level plus the numeric
/// signals the connectors use (risk score and confidence).
struct PromptEval {
    action: String,
    risk_level: String,
    findings: Vec<Finding>,
    reason: String,
    risk_score: u8,
    confidence: u8,
}

/// Evaluates prompt text through the real detector pipeline + optional LLM.
fn evaluate_prompt(text: &str) -> PromptEval {
    let engine = &*ENGINE;
    let input = ScanInput::new(text, pe_core::ScanContext::default());
    let core_findings = engine.registry.scan_all(&input, &Budget::unlimited());

    // Strongest single-finding confidence (0.0–1.0) as a 0–100 percentage —
    // computed over the raw findings before they are mapped to the wire shape.
    let confidence: u8 = (core_findings
        .iter()
        .map(|f| f.confidence)
        .fold(0.0_f32, f32::max)
        * 100.0)
        .round()
        .clamp(0.0, 100.0) as u8;

    // Aggregate risk tier, then let Granite Guardian raise it / attribute a
    // category (raise-only; fail-open to the rule-based score on any error).
    let mut risk = classify_risk(&core_findings, false);
    let mut llm_category: Option<Category> = None;
    if let Some(llm) = &engine.llm {
        let (refined, category) = llm.refine(text, risk);
        risk = refined;
        llm_category = category;
    }

    let findings: Vec<Finding> = core_findings
        .iter()
        .map(|f| Finding {
            detector_id: f.detector_id.clone(),
            category: f.category.wire_name().to_string(),
            kind: f.kind.clone(),
            severity: severity_str(f.severity).to_string(),
            redacted_preview: f.redacted_preview.clone(),
        })
        .collect();

    let has_critical = core_findings.iter().any(|f| f.severity == Severity::Critical);
    let has_high = core_findings.iter().any(|f| f.severity == Severity::High);
    let has_medium = core_findings.iter().any(|f| f.severity == Severity::Medium);
    // The LLM-attributed category, or the highest-severity detector category.
    let primary = pe_core::primary_category(&core_findings)
        .or(llm_category)
        .map(|c| c.wire_name().to_string());

    // Action policy for the dev endpoint (no signed bundle to consult, so the
    // action follows finding severity + the aggregate risk tier):
    //   critical finding / Restricted tier              → block
    //   high or medium finding / Confidential·Sensitive → warn
    //   otherwise (only low-severity noise, e.g. a lone → allow
    //   email or watched keyword)
    let (action, risk_level) = if has_critical || risk.tier == RiskTier::Restricted {
        ("block", "critical")
    } else if has_high || risk.tier == RiskTier::Confidential {
        ("warn", "high")
    } else if has_medium || risk.tier == RiskTier::Sensitive {
        ("warn", "medium")
    } else {
        ("allow", "low")
    };

    let reason = if findings.is_empty() && action == "allow" {
        "No sensitive content detected.".to_string()
    } else {
        let cat = primary.unwrap_or_else(|| "policy".to_string());
        format!(
            "{} — {} finding(s), category {}, risk {} ({})",
            match action {
                "block" => "Blocked by policy",
                "warn" => "Review required",
                _ => "Allowed",
            },
            findings.len(),
            cat,
            risk.score,
            risk.tier.as_str(),
        )
    };

    PromptEval {
        action: action.to_string(),
        risk_level: risk_level.to_string(),
        findings,
        reason,
        risk_score: risk.score,
        confidence,
    }
}

