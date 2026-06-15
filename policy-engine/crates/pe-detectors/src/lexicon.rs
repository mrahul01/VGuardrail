//! Shared phrase-lexicon machinery for the keyword-driven policy detectors.
//!
//! Several of the v2 categories (company-confidential, usage-policy, compliance,
//! IP, keyword policies) are driven by curated phrase lists. This module turns a
//! phrase list into one case-insensitive, word-bounded alternation and emits
//! findings for every match, so each detector stays a thin declaration of its
//! vocabulary plus severity.

use pe_core::{Category, Finding, Severity, Span};
use regex::Regex;

/// Compiles `phrases` into a single case-insensitive, word-bounded alternation.
/// Whitespace inside a phrase matches any run of whitespace. Empty/blank
/// phrases are skipped; an empty list yields `None`.
///
/// # Errors
/// Returns a [`regex::Error`] if the assembled pattern is invalid (e.g. an
/// org-configured phrase produces a pathological pattern).
pub(crate) fn phrase_regex(phrases: &[String]) -> Result<Option<Regex>, regex::Error> {
    let alts: Vec<String> = phrases
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| {
            regex::escape(p)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(r"\s+")
        })
        .collect();
    if alts.is_empty() {
        return Ok(None);
    }
    Regex::new(&format!(r"(?i)\b(?:{})\b", alts.join("|"))).map(Some)
}

/// Convenience for the built-in vocabularies, which are static and known-valid.
pub(crate) fn builtin_phrase_regex(phrases: &[&str]) -> Regex {
    let owned: Vec<String> = phrases.iter().map(|p| (*p).to_string()).collect();
    phrase_regex(&owned)
        .expect("built-in phrase list compiles")
        .expect("built-in phrase list is non-empty")
}

/// Emits one finding per match of `re` in `text`. The preview is the matched
/// policy phrase itself — phrases come from our own vocabulary, never from
/// user-secret material, so they are safe to surface in audit events.
pub(crate) fn phrase_findings(
    re: Option<&Regex>,
    text: &str,
    detector_id: &'static str,
    category: Category,
    kind: &str,
    confidence: f32,
    severity: Severity,
) -> Vec<Finding> {
    let Some(re) = re else {
        return Vec::new();
    };
    re.find_iter(text)
        .map(|m| {
            Finding::new(
                detector_id,
                category,
                kind,
                Span::new(m.start(), m.end()),
                confidence,
                severity,
                m.as_str().to_lowercase(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_match_case_insensitively_with_flexible_whitespace() {
        let re = phrase_regex(&["do not distribute".to_string()])
            .unwrap()
            .unwrap();
        assert!(re.is_match("DO NOT  DISTRIBUTE"));
        assert!(re.is_match("please do not\ndistribute this"));
        assert!(!re.is_match("distribute freely"));
    }

    #[test]
    fn word_boundaries_prevent_substring_matches() {
        let re = phrase_regex(&["secret".to_string()]).unwrap().unwrap();
        assert!(re.is_match("this is secret"));
        assert!(!re.is_match("secretary"));
    }

    #[test]
    fn metacharacters_in_phrases_are_escaped() {
        let re = phrase_regex(&["p&l statement".to_string()]).unwrap().unwrap();
        assert!(re.is_match("the P&L statement for Q3"));
    }

    #[test]
    fn empty_list_yields_none() {
        assert!(phrase_regex(&[]).unwrap().is_none());
        assert!(phrase_regex(&["   ".to_string()]).unwrap().is_none());
    }
}
