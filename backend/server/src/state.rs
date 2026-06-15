//! Shared application state (AWS clients, config, JWKS).

use std::sync::Arc;

use aws_adapters::{AwsClients, ResourceConfig};
use aws_sdk_cognitoidentityprovider as cognito;
use aws_sdk_dynamodb as dynamodb;
use aws_sdk_s3 as s3;
use aws_sdk_secretsmanager as secrets;

use crate::auth::JwksCache;
use crate::config::ServerConfig;

/// Cloned into every Axum handler. Cheap to clone (all Arcs).
#[derive(Clone)]
pub struct AppState {
    /// AWS SDK clients.
    pub aws: AwsClients,
    /// Resource names (table / bucket / user pool / etc.).
    pub resource: ResourceConfig,
    /// Optional Ed25519 pubkey used to verify served policy bundles.
    pub policy_pubkey_b64: Option<String>,
    /// JWKS cache for Cognito JWT verification.
    pub jwks: Arc<JwksCache>,
    /// Full server config.
    pub config: Arc<ServerConfig>,
    /// HTTP client used for JWKS refresh.
    pub http: reqwest::Client,
}

impl AppState {
    /// Loads the AWS clients (using the default credential chain),
    /// fetches the Cognito JWKS, and returns a ready-to-use state.
    ///
    /// # Errors
    /// Returns the JWKS fetch / parse error.
    pub async fn load(config: ServerConfig) -> Result<Self, String> {
        let aws = AwsClients::load().await;
        let policy_pubkey_b64 = config.resource.policy_pubkey_b64.clone();

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("http client: {e}"))?;

        let issuer = cognito_issuer(&config.resource);
        let jwks = JwksCache::load(&http, &issuer)
            .await
            .map_err(|e| format!("jwks load: {e}"))?;

        Ok(Self {
            resource: config.resource.clone(),
            policy_pubkey_b64,
            aws,
            jwks: Arc::new(jwks),
            config: Arc::new(config),
            http,
        })
    }

    /// Convenience: a DynamoDB client.
    #[must_use]
    pub fn dynamodb(&self) -> &dynamodb::Client {
        &self.aws.dynamodb
    }

    /// Convenience: an S3 client.
    #[must_use]
    pub fn s3(&self) -> &s3::Client {
        &self.aws.s3
    }

    /// Convenience: a Cognito IDP client.
    #[must_use]
    pub fn cognito(&self) -> &cognito::Client {
        &self.aws.cognito
    }

    /// Convenience: a Secrets Manager client.
    #[must_use]
    pub fn secrets(&self) -> &secrets::Client {
        &self.aws.secrets
    }
}

/// Build the standard Cognito issuer URL.
fn cognito_issuer(resource: &ResourceConfig) -> String {
    if let Ok(override_issuer) = std::env::var("VG_COGNITO_ISSUER") {
        return override_issuer;
    }
    format!("https://cognito-idp.amazonaws.com/{}", resource.user_pool_id)
}
