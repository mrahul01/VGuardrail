output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "app_client_id" {
  value       = aws_cognito_user_pool_client.device.id
  description = "Device app client ID."
}

output "issuer" {
  value       = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
  description = "JWT issuer URL for the API Gateway authorizer."
}

output "dashboard_client_id" {
  value = aws_cognito_user_pool_client.dashboard.id
}

output "dashboard_client_secret" {
  value     = aws_cognito_user_pool_client.dashboard.client_secret
  sensitive = true
}

output "cognito_domain" {
  value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}
