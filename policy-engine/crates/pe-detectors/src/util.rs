//! Shared detection primitives: entropy, the Luhn check, and IIN→network mapping.

use std::collections::HashMap;

/// Shannon entropy of `s` in bits per character. Used to distinguish
/// high-entropy secrets from ordinary words in the generic-key detector.
#[must_use]
pub fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let len = s.chars().count() as f64;
    let mut counts: HashMap<char, u32> = HashMap::new();
    for c in s.chars() {
        *counts.entry(c).or_insert(0) += 1;
    }
    counts
        .values()
        .map(|&c| {
            let p = f64::from(c) / len;
            -p * p.log2()
        })
        .sum()
}

/// Validates a candidate card number (digits, spaces/dashes already stripped)
/// with the Luhn algorithm. Rejects lengths outside 13..=19.
#[must_use]
pub fn luhn_valid(digits: &str) -> bool {
    let ds: Vec<u32> = digits.chars().filter_map(|c| c.to_digit(10)).collect();
    if ds.len() < 13 || ds.len() > 19 {
        return false;
    }
    let mut sum = 0u32;
    let mut alt = false;
    for &d in ds.iter().rev() {
        let mut x = d;
        if alt {
            x *= 2;
            if x > 9 {
                x -= 9;
            }
        }
        sum += x;
        alt = !alt;
    }
    sum % 10 == 0
}

/// Best-effort card network from the issuer identification number (IIN/BIN).
#[must_use]
pub fn card_network(digits: &str) -> &'static str {
    let n = |len: usize| -> u32 { digits.get(..len).and_then(|s| s.parse().ok()).unwrap_or(0) };
    if digits.starts_with('4') {
        "visa"
    } else if matches!(n(2), 34 | 37) {
        "amex"
    } else if (51..=55).contains(&n(2)) || (2221..=2720).contains(&n(4)) {
        "mastercard"
    } else if digits.starts_with("6011") || n(2) == 65 {
        "discover"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entropy_higher_for_random_than_repeated() {
        assert!(shannon_entropy("aaaaaaaa") < 1.0);
        assert!(shannon_entropy("aZ3$kQ8!pL2#") > 3.0);
    }

    #[test]
    fn luhn_accepts_known_test_numbers() {
        assert!(luhn_valid("4111111111111111")); // Visa test
        assert!(luhn_valid("5500005555555559")); // Mastercard test
        assert!(luhn_valid("340000000000009")); // Amex test
    }

    #[test]
    fn luhn_rejects_invalid_and_wrong_length() {
        assert!(!luhn_valid("4111111111111112"));
        assert!(!luhn_valid("123"));
        assert!(!luhn_valid("12345678901234567890"));
    }

    #[test]
    fn networks_are_identified() {
        assert_eq!(card_network("4111111111111111"), "visa");
        assert_eq!(card_network("5500005555555559"), "mastercard");
        assert_eq!(card_network("340000000000009"), "amex");
        assert_eq!(card_network("6011000000000004"), "discover");
    }
}
