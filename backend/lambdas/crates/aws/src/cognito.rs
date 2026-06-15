//! Cognito adapter: creates the device's user (idempotently) and issues JWTs.

use app::{DeviceIdentityIssuer, StoreError, Tokens, UserIdentityAdmin};
use async_trait::async_trait;
use aws_sdk_cognitoidentityprovider::types::{AttributeType, AuthFlowType, MessageActionType};
use aws_sdk_cognitoidentityprovider::Client;
use uuid::Uuid;

/// Device identity issuer backed by a Cognito User Pool.
pub struct CognitoIdentity {
    client: Client,
    user_pool_id: String,
    app_client_id: String,
}

impl CognitoIdentity {
    /// Builds the issuer.
    pub fn new(
        client: Client,
        user_pool_id: impl Into<String>,
        app_client_id: impl Into<String>,
    ) -> Self {
        Self {
            client,
            user_pool_id: user_pool_id.into(),
            app_client_id: app_client_id.into(),
        }
    }

    fn attr(name: &str, value: &str) -> Result<AttributeType, StoreError> {
        AttributeType::builder()
            .name(name)
            .value(value)
            .build()
            .map_err(|e| StoreError::Backend(format!("attribute: {e}")))
    }
}

#[async_trait]
impl DeviceIdentityIssuer for CognitoIdentity {
    async fn ensure_user_and_issue(
        &self,
        device_id: &str,
        org_id: &str,
    ) -> Result<Tokens, StoreError> {
        // 1. Create the device user (idempotent — ignore "already exists").
        let create = self
            .client
            .admin_create_user()
            .user_pool_id(&self.user_pool_id)
            .username(device_id)
            .message_action(MessageActionType::Suppress)
            .user_attributes(Self::attr("custom:org_id", org_id)?)
            .user_attributes(Self::attr("custom:device_id", device_id)?)
            .send()
            .await;
        if let Err(err) = create {
            let already_exists = err
                .as_service_error()
                .is_some_and(|e| e.is_username_exists_exception());
            if !already_exists {
                return Err(StoreError::Backend(format!("admin_create_user: {err}")));
            }
        }

        // 2. Set a fresh permanent password (the device authenticates with it
        //    just-in-time; it is never returned to the caller).
        let password = format!("Aa1!{}", Uuid::new_v4().simple());
        self.client
            .admin_set_user_password()
            .user_pool_id(&self.user_pool_id)
            .username(device_id)
            .password(&password)
            .permanent(true)
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("admin_set_user_password: {e}")))?;

        // 3. Exchange for tokens via the admin auth flow.
        let auth = self
            .client
            .admin_initiate_auth()
            .user_pool_id(&self.user_pool_id)
            .client_id(&self.app_client_id)
            .auth_flow(AuthFlowType::AdminUserPasswordAuth)
            .auth_parameters("USERNAME", device_id)
            .auth_parameters("PASSWORD", &password)
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("admin_initiate_auth: {e}")))?;

        let result = auth
            .authentication_result()
            .ok_or_else(|| StoreError::Backend("no authentication result".to_string()))?;

        Ok(Tokens {
            access_token: result.access_token().unwrap_or_default().to_string(),
            refresh_token: result.refresh_token().unwrap_or_default().to_string(),
            expires_in: i64::from(result.expires_in()),
        })
    }
}

/// Dashboard user invite/disable backed by Cognito admin APIs.
pub struct CognitoUserAdmin {
    client: Client,
    user_pool_id: String,
}

impl CognitoUserAdmin {
    /// Builds the admin client.
    pub fn new(client: Client, user_pool_id: impl Into<String>) -> Self {
        Self {
            client,
            user_pool_id: user_pool_id.into(),
        }
    }

    fn cognito_group(role: &str) -> &str {
        match role {
            "org_admin" => "manager",
            "viewer" => "user",
            _ => role,
        }
    }
}

#[async_trait]
impl UserIdentityAdmin for CognitoUserAdmin {
    async fn invite_user(
        &self,
        email: &str,
        org_id: &str,
        role: &str,
    ) -> Result<String, StoreError> {
        let username = email.to_lowercase();
        let create = self
            .client
            .admin_create_user()
            .user_pool_id(&self.user_pool_id)
            .username(&username)
            .message_action(MessageActionType::Suppress)
            .user_attributes(CognitoIdentity::attr("email", email)?)
            .user_attributes(CognitoIdentity::attr("email_verified", "true")?)
            .user_attributes(CognitoIdentity::attr("custom:org_id", org_id)?)
            .user_attributes(CognitoIdentity::attr("custom:role", role)?)
            .send()
            .await;
        if let Err(err) = create {
            let already_exists = err
                .as_service_error()
                .is_some_and(|e| e.is_username_exists_exception());
            if !already_exists {
                return Err(StoreError::Backend(format!("admin_create_user: {err}")));
            }
        }
        self.client
            .admin_add_user_to_group()
            .user_pool_id(&self.user_pool_id)
            .username(&username)
            .group_name(Self::cognito_group(role))
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("admin_add_user_to_group: {e}")))?;
        Ok(username)
    }

    async fn delete_user(&self, user_id: &str) -> Result<(), StoreError> {
        self.client
            .admin_disable_user()
            .user_pool_id(&self.user_pool_id)
            .username(user_id)
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("admin_disable_user: {e}")))?;
        self.client
            .admin_delete_user()
            .user_pool_id(&self.user_pool_id)
            .username(user_id)
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("admin_delete_user: {e}")))?;
        Ok(())
    }
}
