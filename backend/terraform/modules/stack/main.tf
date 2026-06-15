# Composes the full Audit Cloud stack for one environment. Each stacks/<env>
# directory is a thin caller of this module.

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  tags = merge(var.tags, {
    Project = "vguardrail"
    Env     = var.env
  })

  # Every function that builds AppCtx requires the full resource env set.
  env_common = {
    VG_CORE_TABLE        = module.dynamodb.core_table_name
    VG_AUDIT_TABLE       = module.dynamodb.audit_table_name
    VG_AUDIT_BUCKET      = module.s3.bucket_name
    VG_USER_POOL_ID      = module.cognito.user_pool_id
    VG_APP_CLIENT_ID     = module.cognito.app_client_id
    VG_ENROLLMENT_PREFIX = module.secrets.prefix
    VG_POLICY_PUBKEY     = var.policy_pubkey_b64
  }

  artifact = { for n in ["health", "register", "policy-latest", "events-batch", "admin-stats", "admin-devices", "admin-audit", "admin-policies-exceptions", "admin-users", "admin-settings"] :
    n => "${var.artifacts_dir}/${n}.zip"
  }
}

module "kms" {
  source     = "../kms"
  env        = var.env
  account_id = local.account_id
  region     = var.region
  tags       = local.tags
}

module "dynamodb" {
  source              = "../dynamodb"
  env                 = var.env
  kms_key_arn         = module.kms.key_arn
  deletion_protection = var.deletion_protection
  tags                = local.tags
}

module "s3" {
  source          = "../s3-audit"
  env             = var.env
  account_id      = local.account_id
  kms_key_arn     = module.kms.key_arn
  retention_years = var.retention_years
  tags            = local.tags
}

module "cognito" {
  source = "../cognito"
  env    = var.env
  region = var.region
  tags   = local.tags
}

module "secrets" {
  source             = "../secrets"
  env                = var.env
  enrollment_secrets = var.enrollment_secrets
  kms_key_arn        = module.kms.key_arn
  tags               = local.tags
}

# ── Per-function least-privilege policies ────────────────────────────────────
locals {
  policy_register = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Secrets", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = module.secrets.secret_arn_wildcard },
      { Sid = "Dynamo", Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Cognito", Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword", "cognito-idp:AdminInitiateAuth", "cognito-idp:AdminAddUserToGroup"], Resource = module.cognito.user_pool_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = module.kms.key_arn }
    ]
  })
  policy_policy_latest = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Dynamo", Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
  policy_events = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Dynamo", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:TransactWriteItems"], Resource = module.dynamodb.audit_table_arn },
      { Sid = "S3", Effect = "Allow", Action = ["s3:PutObject"], Resource = "${module.s3.bucket_arn}/*" },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = module.kms.key_arn }
    ]
  })
  policy_admin_devices = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Core", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Audit", Effect = "Allow", Action = ["dynamodb:Query"], Resource = module.dynamodb.audit_table_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
  policy_admin_audit = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Audit", Effect = "Allow", Action = ["dynamodb:Query", "dynamodb:GetItem"], Resource = module.dynamodb.audit_table_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
  policy_admin_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Core", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
  policy_admin_users = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Core", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Cognito", Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminDisableUser", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminGetUser"], Resource = module.cognito.user_pool_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
  policy_admin_settings = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Core", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem"], Resource = module.dynamodb.core_table_arn },
      { Sid = "Kms", Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms.key_arn }
    ]
  })
}

module "fn_health" {
  source             = "../lambda"
  name               = "health"
  env                = var.env
  filename           = local.artifact["health"]
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 128
  timeout            = 3
  tags               = local.tags
}

module "fn_register" {
  source             = "../lambda"
  name               = "register"
  env                = var.env
  filename           = local.artifact["register"]
  environment        = local.env_common
  policy_json        = local.policy_register
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

module "fn_policy" {
  source             = "../lambda"
  name               = "policy-latest"
  env                = var.env
  filename           = local.artifact["policy-latest"]
  environment        = local.env_common
  policy_json        = local.policy_policy_latest
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 5
  tags               = local.tags
}

module "fn_events" {
  source             = "../lambda"
  name               = "events-batch"
  env                = var.env
  filename           = local.artifact["events-batch"]
  environment        = local.env_common
  policy_json        = local.policy_events
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 512
  timeout            = 15
  tags               = local.tags
}

module "fn_admin_stats" {
  source             = "../lambda"
  name               = "admin-stats"
  env                = var.env
  filename           = local.artifact["admin-stats"]
  environment        = local.env_common
  policy_json        = local.policy_admin_devices
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 5
  tags               = local.tags
}

module "fn_admin_devices" {
  source             = "../lambda"
  name               = "admin-devices"
  env                = var.env
  filename           = local.artifact["admin-devices"]
  environment        = local.env_common
  policy_json        = local.policy_admin_devices
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

module "fn_admin_audit" {
  source             = "../lambda"
  name               = "admin-audit"
  env                = var.env
  filename           = local.artifact["admin-audit"]
  environment        = local.env_common
  policy_json        = local.policy_admin_audit
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

module "fn_admin_policies_exceptions" {
  source             = "../lambda"
  name               = "admin-policies-exceptions"
  env                = var.env
  filename           = local.artifact["admin-policies-exceptions"]
  environment        = local.env_common
  policy_json        = local.policy_admin_policies
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

module "fn_admin_users" {
  source             = "../lambda"
  name               = "admin-users"
  env                = var.env
  filename           = local.artifact["admin-users"]
  environment        = local.env_common
  policy_json        = local.policy_admin_users
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

module "fn_admin_settings" {
  source             = "../lambda"
  name               = "admin-settings"
  env                = var.env
  filename           = local.artifact["admin-settings"]
  environment        = local.env_common
  policy_json        = local.policy_admin_settings
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
  memory_size        = 256
  timeout            = 10
  tags               = local.tags
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/vendedlogs/vguardrail-api-${var.env}"
  retention_in_days = var.log_retention_days
  kms_key_id        = module.kms.key_arn
  tags              = local.tags
}

module "api" {
  source               = "../api"
  env                  = var.env
  jwt_issuer           = module.cognito.issuer
  jwt_audience         = module.cognito.app_client_id
  access_log_group_arn = aws_cloudwatch_log_group.api_access.arn
  routes = {
    "GET /health" = {
      invoke_arn    = module.fn_health.invoke_arn
      function_name = module.fn_health.function_name
      authorized    = false
    }
    "POST /devices/register" = {
      invoke_arn    = module.fn_register.invoke_arn
      function_name = module.fn_register.function_name
      authorized    = false
    }
    "GET /policies/latest" = {
      invoke_arn    = module.fn_policy.invoke_arn
      function_name = module.fn_policy.function_name
      authorized    = true
    }
    "POST /events/batch" = {
      invoke_arn    = module.fn_events.invoke_arn
      function_name = module.fn_events.function_name
      authorized    = true
    }
    "GET /admin/stats" = {
      invoke_arn    = module.fn_admin_stats.invoke_arn
      function_name = module.fn_admin_stats.function_name
      authorized    = true
    }
    "GET /admin/devices" = {
      invoke_arn    = module.fn_admin_devices.invoke_arn
      function_name = module.fn_admin_devices.function_name
      authorized    = true
    }
    "GET /admin/devices/{id}" = {
      invoke_arn    = module.fn_admin_devices.invoke_arn
      function_name = module.fn_admin_devices.function_name
      authorized    = true
    }
    "DELETE /admin/devices/{id}" = {
      invoke_arn    = module.fn_admin_devices.invoke_arn
      function_name = module.fn_admin_devices.function_name
      authorized    = true
    }
    "GET /admin/violations" = {
      invoke_arn    = module.fn_admin_audit.invoke_arn
      function_name = module.fn_admin_audit.function_name
      authorized    = true
    }
    "GET /admin/violations/{id}" = {
      invoke_arn    = module.fn_admin_audit.invoke_arn
      function_name = module.fn_admin_audit.function_name
      authorized    = true
    }
    "GET /admin/audit" = {
      invoke_arn    = module.fn_admin_audit.invoke_arn
      function_name = module.fn_admin_audit.function_name
      authorized    = true
    }
    "GET /admin/audit/{id}" = {
      invoke_arn    = module.fn_admin_audit.invoke_arn
      function_name = module.fn_admin_audit.function_name
      authorized    = true
    }
    "GET /admin/audit/{id}/chain" = {
      invoke_arn    = module.fn_admin_audit.invoke_arn
      function_name = module.fn_admin_audit.function_name
      authorized    = true
    }
    "GET /admin/policies" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "POST /admin/policies" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "GET /admin/policies/{id}" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "PUT /admin/policies/{id}" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "DELETE /admin/policies/{id}" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "GET /admin/policies/{id}/versions" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "POST /admin/policies/{id}/publish" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "GET /admin/exceptions" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "POST /admin/exceptions" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "GET /admin/exceptions/{id}" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "PUT /admin/exceptions/{id}" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "POST /admin/exceptions/{id}/approve" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "POST /admin/exceptions/{id}/reject" = {
      invoke_arn    = module.fn_admin_policies_exceptions.invoke_arn
      function_name = module.fn_admin_policies_exceptions.function_name
      authorized    = true
    }
    "GET /admin/users" = {
      invoke_arn    = module.fn_admin_users.invoke_arn
      function_name = module.fn_admin_users.function_name
      authorized    = true
    }
    "POST /admin/users" = {
      invoke_arn    = module.fn_admin_users.invoke_arn
      function_name = module.fn_admin_users.function_name
      authorized    = true
    }
    "DELETE /admin/users/{id}" = {
      invoke_arn    = module.fn_admin_users.invoke_arn
      function_name = module.fn_admin_users.function_name
      authorized    = true
    }
    "GET /admin/settings" = {
      invoke_arn    = module.fn_admin_settings.invoke_arn
      function_name = module.fn_admin_settings.function_name
      authorized    = true
    }
    "PUT /admin/settings" = {
      invoke_arn    = module.fn_admin_settings.invoke_arn
      function_name = module.fn_admin_settings.function_name
      authorized    = true
    }
  }
  tags = local.tags
}

module "observability" {
  source = "../observability"
  env    = var.env
  region = var.region
  api_id = module.api.api_id
  function_names = [
    module.fn_health.function_name,
    module.fn_register.function_name,
    module.fn_policy.function_name,
    module.fn_events.function_name,
    module.fn_admin_stats.function_name,
    module.fn_admin_devices.function_name,
    module.fn_admin_audit.function_name,
    module.fn_admin_policies_exceptions.function_name,
    module.fn_admin_users.function_name,
    module.fn_admin_settings.function_name,
  ]
  alarm_actions = var.alarm_actions
}
