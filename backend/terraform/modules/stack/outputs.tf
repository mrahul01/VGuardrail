output "api_endpoint" {
  value       = module.api.api_endpoint
  description = "Base invoke URL for the agent."
}

output "user_pool_id" {
  value = module.cognito.user_pool_id
}

output "app_client_id" {
  value = module.cognito.app_client_id
}

output "audit_bucket" {
  value = module.s3.bucket_name
}

output "core_table" {
  value = module.dynamodb.core_table_name
}

output "audit_table" {
  value = module.dynamodb.audit_table_name
}
