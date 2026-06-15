//! The [`Detector`] extension trait and its category-specific refinements.
//!
//! Detectors are **pure**: given the same input they return the same findings,
//! perform no I/O, and read no clock. The only time-awareness is the cooperative
//! [`Budget`] passed to [`Detector::scan`], used to honour the 50 ms SLO.

use crate::context::ScanInput;
use crate::enums::Category;
use crate::finding::Finding;
use crate::time::Budget;

/// A stateless, deterministic content scanner.
///
/// Implementations are registered in the detector registry and invoked
/// concurrently by the engine. They must be `Send + Sync` and side-effect free.
pub trait Detector: Send + Sync {
    /// Stable, namespaced id used by the DSL `detector` predicate
    /// (e.g. `"secret.aws_access_key"`).
    fn id(&self) -> &'static str;

    /// The category this detector belongs to.
    fn category(&self) -> Category;

    /// Scans `input`, returning zero or more findings. Implementations should
    /// check `budget` periodically and return early if it is exhausted, leaving
    /// completeness to the engine.
    fn scan(&self, input: &ScanInput<'_>, budget: &Budget) -> Vec<Finding>;
}

/// Marker refinement for secret/credential detectors.
pub trait SecretDetector: Detector {}

/// Marker refinement for PII detectors.
pub trait PiiDetector: Detector {}

/// A best-guess programming-language classification of a snippet.
#[derive(Debug, Clone, PartialEq)]
pub struct LanguageGuess {
    /// Language name, lowercased (e.g. `"rust"`).
    pub language: String,
    /// Confidence in `[0.0, 1.0]`.
    pub confidence: f32,
}

/// Refinement for source-code detectors, which also expose language guessing for
/// the DSL `sourcecode language_in` predicate.
pub trait SourceCodeDetector: Detector {
    /// Returns the most likely language for the snippet, if any is confident.
    fn classify_language(&self, input: &ScanInput<'_>) -> Option<LanguageGuess>;
}

/// Marker refinement for data-classification detectors.
pub trait ClassificationDetector: Detector {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ScanContext;
    use crate::enums::Severity;
    use crate::finding::Span;

    /// A trivial detector proving the trait is object-safe and usable.
    struct WordDetector;
    impl Detector for WordDetector {
        fn id(&self) -> &'static str {
            "test.word"
        }
        fn category(&self) -> Category {
            Category::Pii
        }
        fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
            input
                .text
                .match_indices("secret")
                .map(|(i, m)| {
                    Finding::new(
                        self.id(),
                        self.category(),
                        "word",
                        Span::new(i, i + m.len()),
                        1.0,
                        Severity::Low,
                        "…",
                    )
                })
                .collect()
        }
    }

    #[test]
    fn detector_is_object_safe_and_runs() {
        let detectors: Vec<Box<dyn Detector>> = vec![Box::new(WordDetector)];
        let input = ScanInput::new("a secret and another secret", ScanContext::default());
        let findings = detectors[0].scan(&input, &Budget::unlimited());
        assert_eq!(findings.len(), 2);
        assert_eq!(detectors[0].id(), "test.word");
    }
}
