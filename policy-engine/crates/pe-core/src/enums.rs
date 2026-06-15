//! Core enumerations of the decision domain.
//!
//! Variant order is **ascending by precedence/severity** so the derived [`Ord`]
//! matches the domain ranking; helper methods ([`Action::rank`],
//! [`Severity::weight`], …) make the ranking explicit and testable.

use serde::{Deserialize, Serialize};

/// Where a monitored prompt originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// A web browser AI site (ChatGPT, Claude, …).
    Browser,
    /// An IDE assistant (Cursor, VS Code, …).
    Ide,
    /// A command-line AI tool (Claude Code, Aider, …).
    Cli,
    /// A direct API client / proxy.
    Api,
}

/// The enforcement action for a prompt. Ordering is the decision precedence:
/// `Allow < Warn < Block`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Forward the prompt unchanged.
    Allow,
    /// Warn the user but allow them to proceed.
    Warn,
    /// Prevent the prompt from leaving the device.
    Block,
}

impl Action {
    /// Numeric precedence rank (`Allow=1 < Warn=2 < Block=3`).
    #[must_use]
    pub const fn rank(self) -> u8 {
        match self {
            Action::Allow => 1,
            Action::Warn => 2,
            Action::Block => 3,
        }
    }

    /// Returns the more restrictive of two actions.
    #[must_use]
    pub fn escalate(self, other: Action) -> Action {
        if other.rank() > self.rank() {
            other
        } else {
            self
        }
    }
}

/// Severity attached to a rule or finding. Ordering: `Low < … < Critical`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Informational.
    Low,
    /// Moderate concern.
    Medium,
    /// Serious concern.
    High,
    /// Most severe.
    Critical,
}

impl Severity {
    /// Numeric rank (`Low=1 … Critical=4`).
    #[must_use]
    pub const fn rank(self) -> u8 {
        match self {
            Severity::Low => 1,
            Severity::Medium => 2,
            Severity::High => 3,
            Severity::Critical => 4,
        }
    }

    /// Additive weight used by the risk scorer (doc 02 §Risk Scoring).
    #[must_use]
    pub const fn weight(self) -> u32 {
        match self {
            Severity::Low => 1,
            Severity::Medium => 3,
            Severity::High => 7,
            Severity::Critical => 15,
        }
    }
}

/// Aggregate risk level of an evaluated prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// Lowest risk.
    Low,
    /// Moderate risk.
    Medium,
    /// High risk.
    High,
    /// Highest risk.
    Critical,
}

/// Data classification of prompt content. Ordering: `Public < … < Restricted`.
/// Context hints may only raise (never lower) the content-derived level.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    /// Safe to share publicly.
    #[default]
    Public,
    /// Internal-only.
    Internal,
    /// Confidential.
    Confidential,
    /// Most sensitive.
    Restricted,
}

/// The category a detector belongs to — the 24 policy categories plus the
/// legacy `classification` derivation category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    /// Secrets / credentials.
    Secret,
    /// Personally identifiable information.
    Pii,
    /// Source code.
    SourceCode,
    /// Data-classification detector.
    Classification,
    /// Internal project / business confidential content.
    CompanyConfidential,
    /// Financial data (bank accounts, routing numbers, revenue reports).
    Financial,
    /// Intellectual property (patents, designs, roadmaps, trade secrets).
    IntellectualProperty,
    /// Organisational AI usage policy violations (legal/medical advice, …).
    UsagePolicy,
    /// Prompt-injection / jailbreak attempts.
    PromptInjection,
    /// Content lifted from sensitive documents (PDF/Office/wiki exports).
    SensitiveDocument,
    /// Customer data (CRM records, customer lists, support tickets).
    CustomerData,
    /// Regulatory compliance triggers (GDPR, HIPAA, PCI-DSS, SOC 2, …).
    Compliance,
    /// Configured confidential-keyword matches.
    Keyword,
    /// Embedded file content (base64 archives, .env/.sql/.pem payloads).
    FilePolicy,
    /// Embedded or referenced images.
    ImagePolicy,
    /// Aggregate AI risk classification (0–100 score, risk tier).
    AiClassification,
    /// Requests to run destructive shell commands (`rm -rf /`, `mkfs`, …).
    DestructiveCommand,
    /// Legal content (privileged communications, litigation, contracts).
    Legal,
    /// Medical / health data (PHI, HIPAA-covered records).
    Medical,
    /// HR content (compensation, performance, disciplinary records).
    Hr,
    /// Security material (vulnerability reports, pentests, incident plans).
    Security,
    /// Research & development (unpublished research, lab data, drafts).
    ResearchDevelopment,
    /// Internal communications (memos, board minutes, briefings).
    Communication,
    /// Procurement & vendor data (contracts, pricing, bids).
    Procurement,
    /// Government / regulated-export material (ITAR, FOUO, clearances).
    Government,
}

impl Category {
    /// The stable snake_case wire name (matches the serde representation).
    #[must_use]
    pub const fn wire_name(self) -> &'static str {
        match self {
            Category::Secret => "secret",
            Category::Pii => "pii",
            Category::SourceCode => "source_code",
            Category::Classification => "classification",
            Category::CompanyConfidential => "company_confidential",
            Category::Financial => "financial",
            Category::IntellectualProperty => "intellectual_property",
            Category::UsagePolicy => "usage_policy",
            Category::PromptInjection => "prompt_injection",
            Category::SensitiveDocument => "sensitive_document",
            Category::CustomerData => "customer_data",
            Category::Compliance => "compliance",
            Category::Keyword => "keyword",
            Category::FilePolicy => "file_policy",
            Category::ImagePolicy => "image_policy",
            Category::AiClassification => "ai_classification",
            Category::DestructiveCommand => "destructive_command",
            Category::Legal => "legal",
            Category::Medical => "medical",
            Category::Hr => "hr",
            Category::Security => "security",
            Category::ResearchDevelopment => "research_development",
            Category::Communication => "communication",
            Category::Procurement => "procurement",
            Category::Government => "government",
        }
    }
}

/// RBAC role of the acting user (used by RBAC-aware rules and exception approval).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Full administrative control.
    SuperAdmin,
    /// Security administration.
    SecurityAdmin,
    /// Read-only audit access.
    Auditor,
    /// Team manager.
    Manager,
    /// Standard end user.
    User,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_precedence_orders_block_highest() {
        assert!(Action::Block > Action::Warn);
        assert!(Action::Warn > Action::Allow);
        assert_eq!(Action::Allow.escalate(Action::Block), Action::Block);
        assert_eq!(Action::Block.escalate(Action::Warn), Action::Block);
    }

    #[test]
    fn severity_weights_are_monotonic() {
        assert!(Severity::Critical.weight() > Severity::High.weight());
        assert!(Severity::High.weight() > Severity::Medium.weight());
        assert!(Severity::Medium.weight() > Severity::Low.weight());
    }

    #[test]
    fn classification_is_ordered() {
        assert!(Classification::Restricted > Classification::Public);
        assert_eq!(
            Classification::Public.max(Classification::Confidential),
            Classification::Confidential
        );
    }

    #[test]
    fn category_wire_name_matches_serde() {
        for c in [
            Category::Secret,
            Category::Pii,
            Category::SourceCode,
            Category::Classification,
            Category::CompanyConfidential,
            Category::Financial,
            Category::IntellectualProperty,
            Category::UsagePolicy,
            Category::PromptInjection,
            Category::SensitiveDocument,
            Category::CustomerData,
            Category::Compliance,
            Category::Keyword,
            Category::FilePolicy,
            Category::ImagePolicy,
            Category::AiClassification,
            Category::DestructiveCommand,
            Category::Legal,
            Category::Medical,
            Category::Hr,
            Category::Security,
            Category::ResearchDevelopment,
            Category::Communication,
            Category::Procurement,
            Category::Government,
        ] {
            let json = serde_json::to_string(&c).unwrap();
            assert_eq!(json, format!("\"{}\"", c.wire_name()));
        }
    }

    #[test]
    fn enums_serialize_snake_case() {
        assert_eq!(serde_json::to_string(&Action::Block).unwrap(), "\"block\"");
        assert_eq!(serde_json::to_string(&Source::Ide).unwrap(), "\"ide\"");
        assert_eq!(
            serde_json::to_string(&Role::SecurityAdmin).unwrap(),
            "\"security_admin\""
        );
        assert_eq!(
            serde_json::from_str::<Classification>("\"restricted\"").unwrap(),
            Classification::Restricted
        );
    }
}
