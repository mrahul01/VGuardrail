//! Resource names and the loaded AWS SDK clients, read once per cold start.

use aws_sdk_cognitoidentityprovider as cognito;
use aws_sdk_dynamodb as dynamodb;
use aws_sdk_s3 as s3;
use aws_sdk_secretsmanager as secrets;

/// Resource identifiers supplied by the environment (set by Terraform).
#[derive(Debug, Clone)]
pub struct ResourceConfig {
    /// Control-plane (single-table) DynamoDB table.
    pub core_table: String,
    /// Audit-event DynamoDB table.
    pub audit_table: String,
    /// S3 bucket for the immutable audit archive.
    pub audit_bucket: String,
    /// Cognito User Pool id.
    pub user_pool_id: String,
    /// Cognito app client id (device token exchange).
    pub app_client_id: String,
    /// Secrets Manager prefix for per-org enrollment secrets.
    pub enrollment_secret_prefix: String,
    /// Optional base64 Ed25519 public key to verify served policy bundles.
    pub policy_pubkey_b64: Option<String>,
}

impl ResourceConfig {
    /// Reads the configuration from environment variables.
    ///
    /// # Errors
    /// Returns the name of the first missing required variable.
    pub fn from_env() -> Result<Self, String> {
        fn req(key: &str) -> Result<String, String> {
            std::env::var(key).map_err(|_| format!("missing env var {key}"))
        }
        Ok(Self {
            core_table: req("VG_CORE_TABLE")?,
            audit_table: req("VG_AUDIT_TABLE")?,
            audit_bucket: req("VG_AUDIT_BUCKET")?,
            user_pool_id: req("VG_USER_POOL_ID")?,
            app_client_id: req("VG_APP_CLIENT_ID")?,
            enrollment_secret_prefix: std::env::var("VG_ENROLLMENT_PREFIX")
                .unwrap_or_else(|_| "vguardrail/enrollment/".to_string()),
            policy_pubkey_b64: std::env::var("VG_POLICY_PUBKEY").ok(),
        })
    }
}

/// The AWS SDK clients used by the adapters.
#[derive(Clone)]
pub struct AwsClients {
    /// DynamoDB client.
    pub dynamodb: dynamodb::Client,
    /// S3 client.
    pub s3: s3::Client,
    /// Cognito IDP client.
    pub cognito: cognito::Client,
    /// Secrets Manager client.
    pub secrets: secrets::Client,
}

impl AwsClients {
    /// Loads the default AWS config and builds the clients.
    pub async fn load() -> Self {
        let conf = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        Self {
            dynamodb: dynamodb::Client::new(&conf),
            s3: s3::Client::new(&conf),
            cognito: cognito::Client::new(&conf),
            secrets: secrets::Client::new(&conf),
        }
    }
}
