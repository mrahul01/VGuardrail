//! Bounded regex compilation with a process-wide cache.
//!
//! `matches` predicates compile user-supplied patterns. To bound ReDoS / memory
//! blow-up we cap the compiled program size, and we cache by pattern so the hot
//! evaluation path never recompiles.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use regex::{Regex, RegexBuilder};

/// Maximum compiled-program size in bytes (ReDoS / memory guard).
const SIZE_LIMIT: usize = 1 << 20; // 1 MiB

fn cache() -> &'static Mutex<HashMap<String, Regex>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Regex>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Compiles `pattern` with size limits enforced. Used at validation time to fail
/// a bad pattern early.
///
/// # Errors
/// Returns the underlying [`regex::Error`] on invalid or oversized patterns.
pub fn compile_checked(pattern: &str) -> Result<Regex, regex::Error> {
    RegexBuilder::new(pattern)
        .size_limit(SIZE_LIMIT)
        .dfa_size_limit(SIZE_LIMIT)
        .build()
}

/// Returns a cached compiled regex for `pattern`, compiling (and caching) on a
/// miss. Cheap to clone (regex is internally reference-counted).
///
/// # Errors
/// Returns the underlying [`regex::Error`] on a compile failure.
pub fn cached(pattern: &str) -> Result<Regex, regex::Error> {
    if let Some(re) = cache().lock().expect("regex cache poisoned").get(pattern) {
        return Ok(re.clone());
    }
    let re = compile_checked(pattern)?;
    cache()
        .lock()
        .expect("regex cache poisoned")
        .insert(pattern.to_string(), re.clone());
    Ok(re)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_and_caches() {
        let a = cached("^gpt-4").unwrap();
        let b = cached("^gpt-4").unwrap();
        assert!(a.is_match("gpt-4o"));
        assert!(b.is_match("gpt-4-turbo"));
        assert!(!a.is_match("claude"));
    }

    #[test]
    fn invalid_pattern_errors() {
        assert!(compile_checked("(").is_err());
    }
}
