# Cognito User Pool: device users (machine identity) + human RBAC groups.

resource "aws_cognito_user_pool" "this" {
  name = "vguardrail-${var.env}"

  username_attributes      = []
  auto_verified_attributes = []

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  # Org + device stamped into the JWT for org-scoped authorization.
  schema {
    name                     = "org_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }
  schema {
    name                     = "device_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  tags = var.tags
}

# Device machine identity.
resource "aws_cognito_user_group" "devices" {
  name         = "devices"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Endpoint devices."
}

# Human RBAC groups (dashboard slice).
resource "aws_cognito_user_group" "rbac" {
  for_each     = toset(["super_admin", "org_admin", "security_admin", "auditor", "manager", "viewer", "user"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.this.id
}

# App client used by the agent for device token exchange (admin auth flow).
resource "aws_cognito_user_pool_client" "device" {
  name         = "vguardrail-device-${var.env}"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# Domain for Hosted UI
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "vguardrail-${var.env}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.this.id
}

data "aws_caller_identity" "current" {}

# App client for the Dashboard (Next.js)
resource "aws_cognito_user_pool_client" "dashboard" {
  name         = "vguardrail-dashboard-${var.env}"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = true

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.dashboard_callback_urls
  logout_urls   = var.dashboard_logout_urls

  enable_token_revocation = true
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}
