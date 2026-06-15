//! Data-classification derivation (doc 02 §7).
//!
//! Classification is derived from the *set* of findings plus repo context, so it
//! is a pure function over detector output rather than a `Detector` itself.
//! Context hints may only raise (never lower) the content-derived level.

use pe_core::{Category, Classification, Finding};

/// Derives the [`Classification`] of content from its findings and any
/// pre-assigned repository classification.
#[must_use]
pub fn derive_classification(
    findings: &[Finding],
    repo_classification: Option<Classification>,
) -> Classification {
    let mut level = Classification::Public;

    for f in findings {
        let contributed = match f.category {
            // Topology identifiers reveal internals but are not credentials.
            Category::Secret if matches!(f.kind.as_str(), "internal_ip" | "internal_domain") => {
                Classification::Confidential
            }
            Category::Secret => Classification::Restricted,
            Category::Pii if matches!(f.kind.as_str(), "credit_card" | "customer_id") => {
                Classification::Confidential
            }
            Category::CompanyConfidential
            | Category::Financial
            | Category::IntellectualProperty
            | Category::CustomerData
            | Category::SensitiveDocument
            | Category::Compliance
            | Category::FilePolicy
            | Category::Medical
            | Category::Security
            | Category::Government => Classification::Confidential,
            Category::Pii
            | Category::SourceCode
            | Category::UsagePolicy
            | Category::PromptInjection
            | Category::Keyword
            | Category::ImagePolicy
            | Category::DestructiveCommand
            | Category::Legal
            | Category::Hr
            | Category::ResearchDevelopment
            | Category::Communication
            | Category::Procurement => Classification::Internal,
            Category::Classification | Category::AiClassification => Classification::Public,
        };
        level = level.max(contributed);
    }

    // Context can only raise the level.
    if let Some(repo) = repo_classification {
        level = level.max(repo);
    }
    level
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::{Severity, Span};

    fn finding(category: Category, kind: &str) -> Finding {
        Finding::new(
            "d",
            category,
            kind,
            Span::new(0, 1),
            1.0,
            Severity::Low,
            "…",
        )
    }

    #[test]
    fn secret_yields_restricted() {
        let f = vec![finding(Category::Secret, "aws_access_key")];
        assert_eq!(derive_classification(&f, None), Classification::Restricted);
    }

    #[test]
    fn credit_card_yields_confidential() {
        let f = vec![finding(Category::Pii, "credit_card")];
        assert_eq!(
            derive_classification(&f, None),
            Classification::Confidential
        );
    }

    #[test]
    fn source_code_yields_internal() {
        let f = vec![finding(Category::SourceCode, "source_code")];
        assert_eq!(derive_classification(&f, None), Classification::Internal);
    }

    #[test]
    fn empty_is_public() {
        assert_eq!(derive_classification(&[], None), Classification::Public);
    }

    #[test]
    fn context_can_only_raise() {
        // Content is Internal but repo is Restricted → Restricted.
        let f = vec![finding(Category::SourceCode, "source_code")];
        assert_eq!(
            derive_classification(&f, Some(Classification::Restricted)),
            Classification::Restricted
        );
        // Content is Restricted but repo is Public → stays Restricted.
        let f = vec![finding(Category::Secret, "aws_access_key")];
        assert_eq!(
            derive_classification(&f, Some(Classification::Public)),
            Classification::Restricted
        );
    }
}
