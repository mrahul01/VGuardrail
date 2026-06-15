//! # pe-detectors
//!
//! Detectors for all 15 VGuardrail policy categories — secrets, PII, source
//! code, company-confidential, financial, intellectual property, usage policy,
//! prompt injection, sensitive documents, customer data, compliance, keyword,
//! file, and image policies — plus the [`DetectorRegistry`], the pure
//! [`derive_classification`] function, and the aggregate AI-classification
//! risk scorer ([`classify_risk`]).
//!
//! Detectors implement the [`pe_core::Detector`] trait: pure, deterministic, and
//! redaction-safe (no raw secret ever leaves a [`pe_core::Finding`]). See
//! the policy-engine README.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod classify;
mod compliance;
mod confidential;
mod customer_data;
mod destructive;
mod document;
mod domains;
mod file_policy;
mod financial;
mod image;
mod ip;
mod keyword;
mod lexicon;
mod pii;
mod prompt_injection;
mod registry;
mod riskscore;
mod secret;
mod sensitive_info;
mod sourcecode;
mod usage_policy;
mod util;

pub use classify::derive_classification;
pub use compliance::ComplianceDetector;
pub use confidential::CompanyConfidentialDetector;
pub use customer_data::CustomerDataDetector;
pub use destructive::DestructiveCommandDetector;
pub use document::SensitiveDocumentDetector;
pub use domains::{DomainLexiconDetector, DomainPhrases};
pub use file_policy::FilePolicyDetector;
pub use financial::FinancialDetector;
pub use image::ImagePolicyDetector;
pub use ip::IntellectualPropertyDetector;
pub use keyword::KeywordPolicyDetector;
pub use pii::{CreditCardDetector, CustomerIdDetector, EmailDetector, PhoneDetector};
pub use prompt_injection::PromptInjectionDetector;
pub use registry::{
    DestructiveCommandsConfig, DetectorConfig, DetectorRegistry, DomainLexiconsConfig,
    SensitiveInfoConfig,
};
pub use riskscore::{classify_risk, RiskScore, RiskTier};
pub use secret::{
    AwsKeyDetector, GenericKeyDetector, GithubTokenDetector, JwtDetector, SshKeyDetector,
};
pub use sensitive_info::SensitiveInfoDetector;
pub use sourcecode::SourceCodeLangDetector;
pub use usage_policy::UsagePolicyDetector;
pub use util::{card_network, luhn_valid, shannon_entropy};
