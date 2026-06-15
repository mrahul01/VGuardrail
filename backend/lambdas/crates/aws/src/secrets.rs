//! Secrets Manager adapter: validates org enrollment secrets.
//!
//! The enrollment token is `"<org_id>.<secret>"`. The org id is read from the
//! prefix, the org's secret fetched, and the full token compared in constant
//! time. A missing secret or mismatch resolves to `None` (registration denied).

use app::{EnrollmentVerifier, StoreError};
use async_trait::async_trait;
use aws_sdk_secretsmanager::Client;

/// Enrollment verifier backed by Secrets Manager.
pub struct SecretsEnrollment {
    client: Client,
    prefix: String,
}

impl SecretsEnrollment {
    /// Builds the verifier. `prefix` is the secret-name prefix, e.g.
    /// `vguardrail/enrollment/`.
    pub fn new(client: Client, prefix: impl Into<String>) -> Self {
        Self {
            client,
            prefix: prefix.into(),
        }
    }
}

#[async_trait]
impl EnrollmentVerifier for SecretsEnrollment {
    async fn resolve_org(&self, token: &str) -> Result<Option<String>, StoreError> {
        let Some((org_id, _)) = token.split_once('.') else {
            return Ok(None);
        };
        if org_id.is_empty() {
            return Ok(None);
        }

        let secret_name = format!("{}{}", self.prefix, org_id);
        let out = self
            .client
            .get_secret_value()
            .secret_id(&secret_name)
            .send()
            .await;

        let expected = match out {
            Ok(v) => v.secret_string().map(str::to_string),
            Err(err) => {
                // A non-existent secret is a denied enrollment, not a 500.
                if err
                    .as_service_error()
                    .is_some_and(|e| e.is_resource_not_found_exception())
                {
                    return Ok(None);
                }
                return Err(StoreError::Backend(format!("get_secret_value: {err}")));
            }
        };

        match expected {
            Some(expected) if constant_time_eq(token.as_bytes(), expected.trim().as_bytes()) => {
                Ok(Some(org_id.to_string()))
            }
            _ => Ok(None),
        }
    }
}

/// Length-aware constant-time byte comparison.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn ct_eq_matches_and_differs() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
