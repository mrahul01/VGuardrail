//! Corpus-driven precision/recall gate (doc 06 §3).
//!
//! For each detector with a corpus, every line in `positives.txt` must be
//! flagged and the precision/recall must clear the floors in `thresholds.toml`.
//! Also asserts the redaction invariant: no preview echoes a full positive line.

use std::path::PathBuf;

use pe_core::{Budget, Detector, ScanContext, ScanInput};

struct Thresholds {
    min_recall: f64,
    min_precision: f64,
}

fn corpus_dir(id: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("corpora")
        .join(id)
}

fn read_lines(path: &PathBuf) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

fn read_thresholds(id: &str) -> Thresholds {
    let raw = std::fs::read_to_string(corpus_dir(id).join("thresholds.toml")).unwrap();
    let parse = |key: &str| -> f64 {
        raw.lines()
            .find(|l| l.starts_with(key))
            .and_then(|l| l.split('=').nth(1))
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(1.0)
    };
    Thresholds {
        min_recall: parse("min_recall"),
        min_precision: parse("min_precision"),
    }
}

fn detector_for(id: &str) -> Box<dyn Detector> {
    // Rebuild the registry and locate the detector by id. We clone behaviour by
    // re-instantiating concrete detectors (registry owns boxed trait objects).
    match id {
        "secret.aws_access_key" => Box::new(pe_detectors::AwsKeyDetector),
        "pii.email" => Box::new(pe_detectors::EmailDetector),
        "pii.credit_card" => Box::new(pe_detectors::CreditCardDetector),
        other => panic!("no detector wired for corpus '{other}'"),
    }
}

fn flags(detector: &dyn Detector, line: &str) -> bool {
    let input = ScanInput::new(line, ScanContext::default());
    !detector.scan(&input, &Budget::unlimited()).is_empty()
}

fn run_gate(id: &str) {
    let detector = detector_for(id);
    let positives = read_lines(&corpus_dir(id).join("positives.txt"));
    let negatives = read_lines(&corpus_dir(id).join("negatives.txt"));
    let th = read_thresholds(id);

    assert!(!positives.is_empty(), "{id}: empty positives corpus");

    let tp = positives
        .iter()
        .filter(|l| flags(detector.as_ref(), l))
        .count();
    let fp = negatives
        .iter()
        .filter(|l| flags(detector.as_ref(), l))
        .count();

    let recall = tp as f64 / positives.len() as f64;
    let precision = if tp + fp == 0 {
        1.0
    } else {
        tp as f64 / (tp + fp) as f64
    };

    assert!(
        recall >= th.min_recall,
        "{id}: recall {recall:.3} < floor {:.3} ({tp}/{} positives)",
        th.min_recall,
        positives.len()
    );
    assert!(
        precision >= th.min_precision,
        "{id}: precision {precision:.3} < floor {:.3} ({fp} false positives)",
        th.min_precision
    );

    // Redaction-safety: a positive's full text must never appear in any preview.
    for line in &positives {
        let input = ScanInput::new(line, ScanContext::default());
        for f in detector.scan(&input, &Budget::unlimited()) {
            assert!(
                !line.contains(&f.redacted_preview) || f.redacted_preview.is_empty(),
                "{id}: preview '{}' leaks corpus content",
                f.redacted_preview
            );
        }
    }
}

#[test]
fn aws_access_key_gate() {
    run_gate("secret.aws_access_key");
}

#[test]
fn email_gate() {
    run_gate("pii.email");
}

#[test]
fn credit_card_gate() {
    run_gate("pii.credit_card");
}
