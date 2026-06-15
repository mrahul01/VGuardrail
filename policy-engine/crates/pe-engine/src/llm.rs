//! Optional local-LLM enrichment for the AI-classification step (category 15),
//! backed by **IBM Granite Guardian 3.0 2B** served through `llama.cpp` (see
//! `docker-compose.local.yml` service `llm` / `provision-policy-rules.sh`).
//!
//! The model is asked for a two-word verdict — a risk tier plus a data-domain
//! category — and the verdict merges into the rule-based [`RiskScore`]: the
//! LLM may only *raise* the tier, never lower it, so the offline baseline
//! remains the floor. The category is advisory (the engine uses it only when
//! no detector produced one).
//!
//! Granite Guardian is trained for templated yes/no risk scoring; the
//! two-word verdict is enforced with a llama.cpp GBNF grammar so the output
//! is always parseable, and a yes/no fallback parse covers servers that
//! ignore `grammar`. Calibration of the tier should be validated against a
//! golden prompt set when changing models.
//!
//! Design constraints (doc 02 §perf):
//! * Strictly bounded latency: one blocking HTTP/1.1 call with connect/read
//!   timeouts; on any error or timeout the rule-based score is returned as-is.
//! * Cached by prompt hash, so repeated prompts are free.
//! * Entirely optional: without the env var the engine never opens a socket.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::Duration;

use pe_core::Category;
use pe_detectors::{RiskScore, RiskTier};

use crate::http::post_json;

/// Grammar forcing `"<tier> <category>"` regardless of model drift.
const VERDICT_GRAMMAR: &str = r#"root ::= tier " " cat
tier ::= "safe" | "low" | "sensitive" | "confidential" | "restricted"
cat ::= "none" | "legal" | "medical" | "hr" | "security" | "research_development" | "communication" | "procurement" | "government""#;

/// Configuration for the LLM classifier.
#[derive(Debug, Clone)]
pub struct LlmConfig {
    /// `host:port` of the llama.cpp HTTP server (e.g. `127.0.0.1:8090`).
    pub endpoint: String,
    /// Total per-call timeout in milliseconds (connect + read).
    pub timeout_ms: u64,
    /// Maximum cached verdicts before the cache is reset.
    pub cache_capacity: usize,
}

impl LlmConfig {
    /// Reads the optional LLM configuration from the environment
    /// (`VG_LLM_ENDPOINT`, `VG_LLM_TIMEOUT_MS`). Returns `None` when unset.
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("VG_LLM_ENDPOINT").ok()?;
        if endpoint.trim().is_empty() {
            return None;
        }
        // Default sized for Granite Guardian 2B Q4 on CPU (~1–4 s p50); the
        // prompt cache amortises repeats and the engine works without the LLM.
        let timeout_ms = std::env::var("VG_LLM_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2500);
        Some(Self {
            endpoint,
            timeout_ms,
            cache_capacity: 4096,
        })
    }
}

/// One LLM verdict: a risk tier plus an optional data-domain category.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmVerdict {
    /// Risk tier (merged raise-only into the baseline).
    pub tier: RiskTier,
    /// Advisory data-domain category (`None` when the model said `none`).
    pub category: Option<Category>,
}

/// A cached, latency-bounded client for the local llama.cpp `/completion` API.
pub struct LlmClassifier {
    config: LlmConfig,
    cache: Mutex<HashMap<u64, LlmVerdict>>,
}

impl LlmClassifier {
    /// Builds a classifier from `config`.
    #[must_use]
    pub fn new(config: LlmConfig) -> Self {
        Self {
            config,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Refines `baseline` with the LLM verdict for `text` and returns the
    /// merged score plus the advisory category. The score is the max of both
    /// tiers; on any transport/parse failure the baseline is returned
    /// unchanged (fail-open to the rule-based floor, never below it).
    #[must_use]
    pub fn refine(&self, text: &str, baseline: RiskScore) -> (RiskScore, Option<Category>) {
        let key = hash_text(text);
        if let Some(verdict) = self.cached(key) {
            return (merge(baseline, verdict.tier), verdict.category);
        }
        let Some(verdict) = self.ask(text) else {
            return (baseline, None);
        };
        self.remember(key, verdict);
        (merge(baseline, verdict.tier), verdict.category)
    }

    fn cached(&self, key: u64) -> Option<LlmVerdict> {
        self.cache.lock().ok()?.get(&key).copied()
    }

    fn remember(&self, key: u64, verdict: LlmVerdict) {
        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= self.config.cache_capacity {
                cache.clear();
            }
            cache.insert(key, verdict);
        }
    }

    /// One bounded llama.cpp `/completion` round trip. Any failure → `None`.
    fn ask(&self, text: &str) -> Option<LlmVerdict> {
        let timeout = Duration::from_millis(self.config.timeout_ms);
        let body = serde_json::json!({
            "prompt": classification_prompt(text),
            "n_predict": 8,
            "temperature": 0,
            "grammar": VERDICT_GRAMMAR,
        })
        .to_string();
        let value = post_json(&self.config.endpoint, "/completion", &body, timeout)?;
        parse_verdict(value.get("content")?.as_str()?)
    }
}

fn hash_text(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn merge(baseline: RiskScore, llm_tier: RiskTier) -> RiskScore {
    if llm_tier > baseline.tier {
        RiskScore {
            // Floor of each tier's band, so score and tier stay consistent.
            score: match llm_tier {
                RiskTier::Safe => baseline.score,
                RiskTier::Low => baseline.score.max(10),
                RiskTier::Sensitive => baseline.score.max(30),
                RiskTier::Confidential => baseline.score.max(60),
                RiskTier::Restricted => baseline.score.max(85),
            },
            tier: llm_tier,
        }
    } else {
        baseline
    }
}

/// Granite Guardian chat-template prompt (raw `/completion` mode tokenizes the
/// `<|start_of_role|>` special tokens). The risk definition frames our
/// enterprise-DLP taxonomy; the answer shape is enforced by the grammar.
fn classification_prompt(text: &str) -> String {
    // Keep the excerpt bounded so the call stays within its latency budget.
    let excerpt: String = text.chars().take(1500).collect();
    format!(
        "<|start_of_role|>user<|end_of_role|>You are a safety agent helping to determine \
whether the user message contains sensitive enterprise data according to the risk \
definition below.\n\n<start_of_turn>\nUser Message: {excerpt}\n<end_of_turn>\n\n\
Our risk definition is defined below:\n<start_of_risk_definition>\n* The message \
contains non-public enterprise data: secrets, personal or medical data, legal, HR, \
security, financial, research, procurement, government-controlled, or internal \
communication content that must not leave the organization.\n<end_of_risk_definition>\n\n\
Assess the message. Answer with exactly two words: first the risk tier (safe, low, \
sensitive, confidential, or restricted), then the data category (none, legal, medical, \
hr, security, research_development, communication, procurement, or government).\
<|end_of_text|>\n<|start_of_role|>assistant<|end_of_role|>"
    )
}

fn parse_tier(word: &str) -> Option<RiskTier> {
    match word {
        "safe" => Some(RiskTier::Safe),
        "low" => Some(RiskTier::Low),
        "sensitive" => Some(RiskTier::Sensitive),
        "confidential" => Some(RiskTier::Confidential),
        "restricted" => Some(RiskTier::Restricted),
        _ => None,
    }
}

fn parse_category(word: &str) -> Option<Category> {
    match word {
        "legal" => Some(Category::Legal),
        "medical" => Some(Category::Medical),
        "hr" => Some(Category::Hr),
        "security" => Some(Category::Security),
        "research_development" => Some(Category::ResearchDevelopment),
        "communication" => Some(Category::Communication),
        "procurement" => Some(Category::Procurement),
        "government" => Some(Category::Government),
        _ => None,
    }
}

/// Parses `"<tier> [category]"`. Forgiving of case/punctuation; falls back to
/// Granite's native yes/no vocabulary when the grammar wasn't applied.
fn parse_verdict(content: &str) -> Option<LlmVerdict> {
    let lowered = content.trim().to_lowercase();
    let mut words = lowered
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !(c.is_alphanumeric() || c == '_')));
    let first = words.next()?;
    if let Some(tier) = parse_tier(first) {
        return Some(LlmVerdict {
            tier,
            category: words.next().and_then(parse_category),
        });
    }
    // Yes/no fallback: Granite Guardian's native scoring vocabulary.
    match first {
        "yes" => Some(LlmVerdict {
            tier: RiskTier::Sensitive,
            category: None,
        }),
        "no" => Some(LlmVerdict {
            tier: RiskTier::Safe,
            category: None,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};
    use std::net::TcpListener;

    /// Stub llama.cpp `/completion` server answering one request.
    fn serve_once(content: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                // Drain the request line + headers.
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok() {
                    if line.ends_with("\r\n\r\n") || line == "\r\n" {
                        break;
                    }
                    if !line.ends_with('\n') {
                        break;
                    }
                    line.clear();
                }
                let body = format!("{{\"content\": \"{content}\"}}");
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

    fn classifier(endpoint: String) -> LlmClassifier {
        LlmClassifier::new(LlmConfig {
            endpoint,
            timeout_ms: 1000,
            cache_capacity: 8,
        })
    }

    #[test]
    fn llm_can_raise_but_not_lower_the_tier() {
        let c = classifier(serve_once("restricted government"));
        let baseline = RiskScore {
            score: 0,
            tier: RiskTier::Safe,
        };
        let (refined, category) = c.refine("internal codename zeus", baseline);
        assert_eq!(refined.tier, RiskTier::Restricted);
        assert!(refined.score >= 85);
        assert_eq!(category, Some(Category::Government));

        // Second call hits the cache (the listener is gone) and a lower LLM
        // verdict can never lower a higher baseline.
        let high = RiskScore {
            score: 90,
            tier: RiskTier::Restricted,
        };
        let (refined, category) = c.refine("internal codename zeus", high);
        assert_eq!(refined.tier, RiskTier::Restricted);
        assert_eq!(category, Some(Category::Government), "category cached too");
    }

    #[test]
    fn unreachable_endpoint_falls_back_to_baseline() {
        let c = classifier("127.0.0.1:1".to_string());
        let baseline = RiskScore {
            score: 30,
            tier: RiskTier::Sensitive,
        };
        assert_eq!(c.refine("anything", baseline), (baseline, None));
    }

    #[test]
    fn verdict_parsing_is_forgiving() {
        assert_eq!(
            parse_verdict("confidential medical"),
            Some(LlmVerdict {
                tier: RiskTier::Confidential,
                category: Some(Category::Medical),
            })
        );
        assert_eq!(
            parse_verdict(" Restricted. government\n"),
            Some(LlmVerdict {
                tier: RiskTier::Restricted,
                category: Some(Category::Government),
            })
        );
        assert_eq!(
            parse_verdict("sensitive research_development"),
            Some(LlmVerdict {
                tier: RiskTier::Sensitive,
                category: Some(Category::ResearchDevelopment),
            })
        );
        assert_eq!(
            parse_verdict("safe none"),
            Some(LlmVerdict {
                tier: RiskTier::Safe,
                category: None,
            })
        );
        assert_eq!(
            parse_verdict("SAFE"),
            Some(LlmVerdict {
                tier: RiskTier::Safe,
                category: None,
            })
        );
        assert_eq!(parse_verdict("I think it is fine"), None);
    }

    #[test]
    fn yes_no_fallback_covers_native_granite_scoring() {
        assert_eq!(
            parse_verdict("Yes"),
            Some(LlmVerdict {
                tier: RiskTier::Sensitive,
                category: None,
            })
        );
        assert_eq!(
            parse_verdict("No"),
            Some(LlmVerdict {
                tier: RiskTier::Safe,
                category: None,
            })
        );
    }
}
