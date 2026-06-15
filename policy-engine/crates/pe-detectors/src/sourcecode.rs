//! Heuristic source-code language detector (doc 02 §5, P-14).
//!
//! Scores a snippet against per-language signal sets and emits a finding (and a
//! [`LanguageGuess`]) when the best language clears a confidence threshold.

use pe_core::{
    Budget, Category, Detector, Finding, LanguageGuess, ScanInput, Severity, SourceCodeDetector,
    Span,
};

/// Languages recognised in v1 (PROJECT_SPEC source-code list).
const LANGUAGES: &[(&str, &[&str])] = &[
    (
        "rust",
        &[
            "fn ",
            "let mut ",
            "impl ",
            "pub fn",
            "println!",
            "use crate",
            "-> ",
        ],
    ),
    (
        "python",
        &[
            "def ", "import ", "print(", "elif ", "self.", "__init__", "    ",
        ],
    ),
    (
        "swift",
        &[
            "func ",
            "guard ",
            "var ",
            "@objc",
            "import Swift",
            "let ",
            "?? ",
        ],
    ),
    (
        "javascript",
        &[
            "function ",
            "const ",
            "=>",
            "console.log",
            "require(",
            "var ",
            "let ",
        ],
    ),
    (
        "typescript",
        &[
            "interface ",
            ": string",
            ": number",
            "export ",
            "import {",
            "=> ",
            "type ",
        ],
    ),
    (
        "go",
        &[
            "package ", "func ", "import (", ":=", "fmt.", "chan ", "go func",
        ],
    ),
    (
        "java",
        &[
            "public class",
            "void ",
            "System.out.println",
            "import java",
            "public static",
            "new ",
        ],
    ),
];

/// Config/markup formats recognised by the gate (chained code-classifier
/// entry point: config files carry infrastructure detail that the optional
/// fine-tuned classifier inspects further).
const CONFIG_FORMATS: &[(&str, &[&str])] = &[
    ("yaml", &["---", "\n- ", ": |", ": >", ":\n  ", ":\n- "]),
    ("json", &["{\"", "\": ", "\":", "},", "\"}\n", "[{"]),
    (
        "toml",
        &["[[", " = \"", " = true", " = false", "[dependencies", " = ["],
    ),
    (
        "dockerfile",
        &["FROM ", "RUN ", "COPY ", "ENTRYPOINT", "WORKDIR", "EXPOSE "],
    ),
    (
        "shell",
        &["#!/bin/", "#!/usr/bin/env", "export ", "set -e", "$(", "fi\n"],
    ),
    ("ini", &["\n[", "]\n", " = "]),
];

/// Minimum number of distinct signals before a language is reported.
const MIN_SIGNALS: usize = 2;

/// Detects source code and its language.
#[derive(Default)]
pub struct SourceCodeLangDetector;

impl SourceCodeLangDetector {
    fn best_in(
        table: &'static [(&'static str, &'static [&'static str])],
        text: &str,
    ) -> Option<(&'static str, usize)> {
        let mut best: Option<(&'static str, usize)> = None;
        for (lang, signals) in table {
            let hits = signals.iter().filter(|s| text.contains(**s)).count();
            if hits >= MIN_SIGNALS && best.is_none_or(|(_, b)| hits > b) {
                best = Some((lang, hits));
            }
        }
        best
    }

    /// `.env`-style blocks: at least two `KEY=VALUE` lines with SCREAMING keys.
    fn looks_like_env(text: &str) -> bool {
        text.lines()
            .filter(|line| {
                let Some((key, _)) = line.split_once('=') else {
                    return false;
                };
                !key.is_empty()
                    && key.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                    && key
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            })
            .count()
            >= 2
    }

    /// Programming language, then config formats; `format` says which table hit.
    fn best_guess_with_format(text: &str) -> Option<(LanguageGuess, &'static str)> {
        if let Some((lang, hits)) = Self::best_in(LANGUAGES, text) {
            return Some((
                LanguageGuess {
                    language: lang.to_string(),
                    // 2 signals → 0.6, capped at 0.95.
                    confidence: (0.4 + 0.1 * hits as f32).min(0.95),
                },
                "code",
            ));
        }
        if let Some((format, hits)) = Self::best_in(CONFIG_FORMATS, text) {
            return Some((
                LanguageGuess {
                    language: format.to_string(),
                    confidence: (0.4 + 0.1 * hits as f32).min(0.95),
                },
                "config",
            ));
        }
        if Self::looks_like_env(text) {
            return Some((
                LanguageGuess {
                    language: "env".to_string(),
                    confidence: 0.8,
                },
                "config",
            ));
        }
        None
    }

    fn best_guess(text: &str) -> Option<LanguageGuess> {
        Self::best_guess_with_format(text).map(|(guess, _)| guess)
    }
}

impl Detector for SourceCodeLangDetector {
    fn id(&self) -> &'static str {
        "sourcecode"
    }
    fn category(&self) -> Category {
        Category::SourceCode
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        match Self::best_guess_with_format(input.text) {
            Some((guess, format)) => vec![Finding::new(
                self.id(),
                Category::SourceCode,
                "source_code",
                Span::new(0, input.text.len()),
                guess.confidence,
                Severity::Medium,
                String::new(),
            )
            .with_meta("language", guess.language)
            .with_meta("format", format)],
            None => Vec::new(),
        }
    }
}

impl SourceCodeDetector for SourceCodeLangDetector {
    fn classify_language(&self, input: &ScanInput<'_>) -> Option<LanguageGuess> {
        Self::best_guess(input.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn guess(text: &str) -> Option<LanguageGuess> {
        SourceCodeLangDetector.classify_language(&ScanInput::new(text, ScanContext::default()))
    }

    #[test]
    fn detects_rust() {
        let g = guess("pub fn main() {\n    let mut x = 1;\n    println!(\"{}\", x);\n}").unwrap();
        assert_eq!(g.language, "rust");
        assert!(g.confidence >= 0.6);
    }

    #[test]
    fn detects_python() {
        let g = guess("def add(a, b):\n    import os\n    print(a + b)").unwrap();
        assert_eq!(g.language, "python");
    }

    #[test]
    fn detects_go() {
        let g = guess("package main\nimport (\n)\nfunc main() {\n  x := 1\n  fmt.Println(x)\n}")
            .unwrap();
        assert_eq!(g.language, "go");
    }

    #[test]
    fn prose_is_not_code() {
        assert!(guess("The quick brown fox jumps over the lazy dog.").is_none());
    }

    #[test]
    fn scan_emits_language_meta() {
        let f = SourceCodeLangDetector.scan(
            &ScanInput::new(
                "pub fn f() -> i32 { let mut x = 0; x }",
                ScanContext::default(),
            ),
            &Budget::unlimited(),
        );
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].meta.get("language").map(String::as_str), Some("rust"));
        assert_eq!(f[0].meta.get("format").map(String::as_str), Some("code"));
    }

    fn scan_format(text: &str) -> Option<(String, String)> {
        let f = SourceCodeLangDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        );
        f.first().map(|f| {
            (
                f.meta.get("language").cloned().unwrap_or_default(),
                f.meta.get("format").cloned().unwrap_or_default(),
            )
        })
    }

    #[test]
    fn detects_config_formats() {
        let cases = [
            ("---\nname: deploy\nsteps:\n  - run: make\n  - run: test\n", "yaml"),
            ("{\"user\": \"x\", \"roles\": [{\"id\": 1}], \"active\": true},", "json"),
            ("[dependencies]\nserde = \"1\"\nfeature = true\nflag = false\nx = [1]\n", "toml"),
            ("FROM rust:1.96\nRUN cargo build\nCOPY . /app\nWORKDIR /app\n", "dockerfile"),
            ("#!/bin/bash\nset -e\nexport FOO=1\necho $(date)\n", "shell"),
        ];
        for (text, expected) in cases {
            let (language, format) = scan_format(text).unwrap_or_else(|| panic!("no finding for {expected}"));
            assert_eq!(language, expected);
            assert_eq!(format, "config", "{expected} should be format=config");
        }
    }

    #[test]
    fn detects_env_blocks() {
        let (language, format) =
            scan_format("DATABASE_URL=postgres://h/db\nAPI_TIMEOUT_MS=8000\n").unwrap();
        assert_eq!(language, "env");
        assert_eq!(format, "config");
    }

    #[test]
    fn config_prose_stays_clean() {
        assert!(scan_format("Let me explain: the plan has three steps - design, build, ship.").is_none());
        assert!(scan_format("E=mc2 is Einstein's equation.").is_none());
    }
}
