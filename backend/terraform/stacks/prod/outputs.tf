output "api_endpoint" {
  value = module.stack.api_endpoint
}

output "user_pool_id" {
  value = module.stack.user_pool_id
}

output "app_client_id" {
  value = module.stack.app_client_id
}

output "audit_bucket" {
  value = module.stack.audit_bucket
}
