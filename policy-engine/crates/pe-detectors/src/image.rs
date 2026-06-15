//! Image-policy detection (category 14 of 15). MVP posture: any embedded image
//! (data URI or bare base64 with an image magic) or image URL is flagged so
//! policy can warn/block, unless the org whitelists images entirely
//! ([`crate::DetectorConfig::allow_images`]). Vision-model description is an
//! engine-layer enrichment, not part of this offline baseline.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

static DATA_URI_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"data:image/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=]{32,}").unwrap()
});
/// Bare base64 with a known image magic (PNG, JPEG, GIF, RIFF/WebP).
static BASE64_IMAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:iVBORw0KGgo|/9j/4|R0lGOD(?:dh|lh)|UklGR)[A-Za-z0-9+/]{64,}={0,2}").unwrap()
});
static IMAGE_URL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"https?://\S+\.(?:png|jpe?g|gif|webp|bmp)\b").unwrap());

/// Detects embedded or referenced images.
pub struct ImagePolicyDetector {
    /// When true the detector is disabled (org whitelists image prompts).
    pub allow_images: bool,
}

impl Default for ImagePolicyDetector {
    fn default() -> Self {
        Self { allow_images: false }
    }
}

impl Detector for ImagePolicyDetector {
    fn id(&self) -> &'static str {
        "image_policy.embedded_image"
    }
    fn category(&self) -> Category {
        Category::ImagePolicy
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        if self.allow_images {
            return Vec::new();
        }
        let text = input.text;
        let mut out = Vec::new();

        for m in DATA_URI_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::ImagePolicy,
                "image_data_uri",
                Span::new(m.start(), m.end()),
                0.95,
                Severity::High,
                "data:image/…;base64,…",
            ));
        }
        for m in BASE64_IMAGE_RE.find_iter(text) {
            // Skip payloads already claimed as data URIs.
            if out.iter().any(|f| f.span.start <= m.start() && m.end() <= f.span.end) {
                continue;
            }
            out.push(Finding::new(
                self.id(),
                Category::ImagePolicy,
                "image_base64",
                Span::new(m.start(), m.end()),
                0.9,
                Severity::High,
                "base64 image payload",
            ));
        }
        for m in IMAGE_URL_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::ImagePolicy,
                "image_url",
                Span::new(m.start(), m.end()),
                0.6,
                Severity::Low,
                m.as_str().to_string(),
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(d: &ImagePolicyDetector, text: &str) -> Vec<Finding> {
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn data_uri_detected() {
        let d = ImagePolicyDetector::default();
        let uri = format!("data:image/png;base64,{}", "A".repeat(64));
        let f = scan(&d, &uri);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "image_data_uri");
        // Preview never includes payload bytes.
        assert!(!f[0].redacted_preview.contains("AAAA"));
    }

    #[test]
    fn bare_png_base64_detected() {
        let d = ImagePolicyDetector::default();
        let blob = format!("iVBORw0KGgo{}", "B".repeat(100));
        assert_eq!(scan(&d, &blob)[0].kind, "image_base64");
    }

    #[test]
    fn image_url_is_low_severity() {
        let d = ImagePolicyDetector::default();
        let f = scan(&d, "look at https://example.com/photo.jpg please");
        assert_eq!(f[0].kind, "image_url");
        assert_eq!(f[0].severity, Severity::Low);
    }

    #[test]
    fn whitelist_disables_detector() {
        let d = ImagePolicyDetector { allow_images: true };
        let uri = format!("data:image/png;base64,{}", "A".repeat(64));
        assert!(scan(&d, &uri).is_empty());
    }
}
