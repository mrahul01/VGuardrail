//! Optional second-stage classifier for source-code/config snippets.
//!
//! Chain position: the cheap language/config
//! gate in `pe-detectors::sourcecode` decides *what* the text is; this
//! classifier — a fine-tuned encoder (CodeBERT/DeBERTa) served over HTTP —
//! decides whether the code itself is sensitive (internal infrastructure,
//! proprietary logic) or public boilerplate. It runs only when the gate
//! produced a `source_code` finding, and its verdict can only *raise* the
//! risk tier (Confidential floor), mirroring the LLM layer's semantics.
//!
//! Contract — TEI-style `POST /predict`:
//!   request : {"inputs": "<snippet, ≤4000 chars>"}
//!   response: [{"label": "sensitive", "score": 0.93}, {"label": "public", …}]
//! The max-score element wins. Any failure → no-op (fail-open).

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::Duration;

use pe_detectors::{RiskScore, RiskTier};

use crate::http::post_json;
use crate::llm::merge;

/// Minimum `sensitive` confidence before the verdict raises the tier.
const SENSITIVE_THRESHOLD: f64 = 0.8;

/// Configuration for the code classifier sidecar.
#[derive(Debug, Clone)]
pub struct CodeClassifierConfig {
    /// `host:port` of the classifier HTTP server.
    pub endpoint: String,
    /// Total per-call timeout in milliseconds (encoder models are fast).
    pub timeout_ms: u64,
    /// Maximum cached verdicts before the cache is reset.
    pub cache_capacity: usize,
}

impl CodeClassifierConfig {
    /// Reads the optional configuration from the environment
    /// (`VG_CODE_CLASSIFIER_ENDPOINT`, `VG_CODE_CLASSIFIER_TIMEOUT_MS`).
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("VG_CODE_CLASSIFIER_ENDPOINT").ok()?;
        if endpoint.trim().is_empty() {
            return None;
        }
        let timeout_ms = std::env::var("VG_CODE_CLASSIFIER_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(400);
        Some(Self {
            endpoint,
            timeout_ms,
            cache_capacity: 4096,
        })
    }
}

/// Verdict for one snippet: was it sensitive, and with what confidence?
#[derive(Debug, Clone, Copy, PartialEq)]
struct CodeVerdict {
    sensitive: bool,
    score: f64,
}

/// A cached, latency-bounded client for the code-classifier `/predict` API.
pub struct CodeClassifier {
    config: CodeClassifierConfig,
    cache: Mutex<HashMap<u64, CodeVerdict>>,
}

impl CodeClassifier {
    /// Builds a classifier from `config`.
    #[must_use]
    pub fn new(config: CodeClassifierConfig) -> Self {
        Self {
            config,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Refines `baseline` with the classifier verdict for a code snippet.
    /// A confident `sensitive` verdict raises the tier to the Confidential
    /// floor; everything else (public verdict, low confidence, any failure)
    /// leaves the baseline untouched. Returns the score plus the verdict
    /// metadata for the synthetic finding (`label`, `score`).
    #[must_use]
    pub fn refine(&self, text: &str, baseline: RiskScore) -> (RiskScore, Option<(String, f64)>) {
        let key = hash_text(text);
        let verdict = match self.cached(key) {
            Some(v) => v,
            None => {
                let Some(v) = self.ask(text) else {
                    return (baseline, None);
                };
                self.remember(key, v);
                v
            }
        };
        let label = if verdict.sensitive { "sensitive" } else { "public" };
        let refined = if verdict.sensitive && verdict.score >= SENSITIVE_THRESHOLD {
            merge(baseline, RiskTier::Confidential)
        } else {
            baseline
        };
        (refined, Some((label.to_string(), verdict.score)))
    }

    fn cached(&self, key: u64) -> Option<CodeVerdict> {
        self.cache.lock().ok()?.get(&key).copied()
    }

    fn remember(&self, key: u64, verdict: CodeVerdict) {
        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= self.config.cache_capacity {
                cache.clear();
            }
            cache.insert(key, verdict);
        }
    }

    /// One bounded `/predict` round trip. Any failure → `None`.
    fn ask(&self, text: &str) -> Option<CodeVerdict> {
        let timeout = Duration::from_millis(self.config.timeout_ms);
        let snippet: String = text.chars().take(4000).collect();
        let body = serde_json::json!({ "inputs": snippet }).to_string();
        let value = post_json(&self.config.endpoint, "/predict", &body, timeout)?;
        // TEI nests one prediction list per input; accept both flat and nested.
        let list = value.as_array()?;
        let list = match list.first() {
            Some(serde_json::Value::Array(inner)) => inner,
            _ => list,
        };
        let best = list
            .iter()
            .filter_map(|entry| {
                let label = entry.get("label")?.as_str()?;
                let score = entry.get("score")?.as_f64()?;
                Some((label, score))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))?;
        Some(CodeVerdict {
            sensitive: best.0.eq_ignore_ascii_case("sensitive"),
            score: best.1,
        })
    }
}

fn hash_text(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};
    use std::net::TcpListener;

    /// Stub `/predict` server answering one request with a raw JSON body.
    fn serve_raw(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok() {
                    if line == "\r\n" || !line.ends_with('\n') {
                        break;
                    }
                    line.clear();
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        addr
    }

    fn classifier(endpoint: String) -> CodeClassifier {
        CodeClassifier::new(CodeClassifierConfig {
            endpoint,
            timeout_ms: 1000,
            cache_capacity: 8,
        })
    }

    fn baseline() -> RiskScore {
        RiskScore {
            score: 20,
            tier: RiskTier::Low,
        }
    }

    #[test]
    fn confident_sensitive_verdict_raises_to_confidential() {
        let c = classifier(serve_raw(
            r#"[{"label": "sensitive", "score": 0.93}, {"label": "public", "score": 0.07}]"#,
        ));
        let (refined, meta) = c.refine("fn secret() {}", baseline());
        assert_eq!(refined.tier, RiskTier::Confidential);
        assert!(refined.score >= 60);
        assert_eq!(meta, Some(("sensitive".to_string(), 0.93)));
    }

    #[test]
    fn public_verdict_keeps_baseline() {
        let c = classifier(serve_raw(
            r#"[{"label": "public", "score": 0.97}, {"label": "sensitive", "score": 0.03}]"#,
        ));
        let (refined, meta) = c.refine("println hello", baseline());
        assert_eq!(refined, baseline());
        assert_eq!(meta, Some(("public".to_string(), 0.97)));
    }

    #[test]
    fn low_confidence_sensitive_does_not_raise() {
        let c = classifier(serve_raw(
            r#"[{"label": "sensitive", "score": 0.55}, {"label": "public", "score": 0.45}]"#,
        ));
        let (refined, _) = c.refine("maybe code", baseline());
        assert_eq!(refined, baseline());
    }

    #[test]
    fn nested_tei_response_shape_is_accepted() {
        let c = classifier(serve_raw(
            r#"[[{"label": "sensitive", "score": 0.91}, {"label": "public", "score": 0.09}]]"#,
        ));
        let (refined, _) = c.refine("nested shape", baseline());
        assert_eq!(refined.tier, RiskTier::Confidential);
    }

    #[test]
    fn malformed_response_and_dead_endpoint_fail_open() {
        let c = classifier(serve_raw("not json at all"));
        assert_eq!(c.refine("x", baseline()), (baseline(), None));

        let dead = classifier("127.0.0.1:1".to_string());
        assert_eq!(dead.refine("x", baseline()), (baseline(), None));
    }
}
