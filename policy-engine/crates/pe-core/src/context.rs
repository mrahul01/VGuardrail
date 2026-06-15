//! The request input handed to the engine and the context it carries.

use serde::{Deserialize, Serialize};

use crate::enums::{Classification, Role, Source};

/// Hard cap on the number of bytes scanned for a single request (doc 00 P-09).
/// Larger inputs are scanned over the first `MAX_SCAN_BYTES` and flagged
/// [`ScanInput::truncated`].
pub const MAX_SCAN_BYTES: usize = 256 * 1024;

/// A normalized prompt ready for detection.
///
/// Borrows its `text` to avoid copying potentially large prompts. It is built at
/// the gRPC boundary and never serialized (raw prompt content must never be
/// persisted — doc 00 P-10), hence no `Serialize`/`Deserialize`.
#[derive(Debug, Clone)]
pub struct ScanInput<'a> {
    /// The (already length-bounded) text to scan.
    pub text: &'a str,
    /// True when the original input exceeded [`MAX_SCAN_BYTES`] and was truncated.
    pub truncated: bool,
    /// Non-content context describing where the prompt came from.
    pub context: ScanContext,
}

impl<'a> ScanInput<'a> {
    /// Builds a [`ScanInput`], truncating `text` to [`MAX_SCAN_BYTES`] on a UTF-8
    /// boundary and setting [`ScanInput::truncated`] accordingly.
    #[must_use]
    pub fn new(text: &'a str, context: ScanContext) -> Self {
        if text.len() <= MAX_SCAN_BYTES {
            return Self {
                text,
                truncated: false,
                context,
            };
        }
        // Find the largest char boundary <= MAX_SCAN_BYTES.
        let mut end = MAX_SCAN_BYTES;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        Self {
            text: &text[..end],
            truncated: true,
            context,
        }
    }

    /// Number of bytes that will actually be scanned.
    #[must_use]
    pub fn bytes(&self) -> usize {
        self.text.len()
    }
}

/// Non-content metadata describing the origin of a prompt.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanContext {
    /// Origin surface (browser/IDE/CLI/API).
    pub source: Option<Source>,
    /// External AI provider, e.g. `"openai"`.
    pub provider: Option<String>,
    /// Model identifier, e.g. `"gpt-4o"`.
    pub model: Option<String>,
    /// Application name, e.g. `"Cursor"`.
    pub app: Option<String>,
    /// Repository context, when the source is an IDE/CLI in a repo.
    pub repo: Option<RepoContext>,
    /// File context, when a specific file is in scope.
    pub file: Option<FileContext>,
    /// Acting user.
    pub user: UserContext,
}

/// Repository context for IDE/CLI prompts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RepoContext {
    /// Repository name / slug.
    pub name: String,
    /// Pre-assigned classification of the repo, if known.
    pub classification: Option<Classification>,
}

/// File context for a prompt referencing a specific file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileContext {
    /// File path (relative to repo root when available).
    pub path: String,
    /// File extension without the dot, e.g. `"rs"`.
    pub extension: Option<String>,
}

/// The acting user, including RBAC role and group memberships (used to match
/// exception subjects — doc 01 §4a).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserContext {
    /// Stable user identifier.
    pub user_id: String,
    /// RBAC role.
    pub role: Role,
    /// Groups the user belongs to (for `subject.kind = "group"` exceptions).
    #[serde(default)]
    pub groups: Vec<String>,
}

impl Default for UserContext {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            role: Role::User,
            groups: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_oversized_input_on_char_boundary() {
        let big = "a".repeat(MAX_SCAN_BYTES + 100);
        let input = ScanInput::new(&big, ScanContext::default());
        assert!(input.truncated);
        assert_eq!(input.bytes(), MAX_SCAN_BYTES);
    }

    #[test]
    fn small_input_is_not_truncated() {
        let input = ScanInput::new("hello", ScanContext::default());
        assert!(!input.truncated);
        assert_eq!(input.bytes(), 5);
    }

    #[test]
    fn truncation_respects_multibyte_boundaries() {
        // Each '€' is 3 bytes; build a string longer than the cap.
        let s = "€".repeat(MAX_SCAN_BYTES); // 3 * cap bytes
        let input = ScanInput::new(&s, ScanContext::default());
        assert!(input.truncated);
        // Must still be valid UTF-8 (slicing on a boundary).
        assert!(input.text.len() <= MAX_SCAN_BYTES);
        assert!(std::str::from_utf8(input.text.as_bytes()).is_ok());
    }
}
