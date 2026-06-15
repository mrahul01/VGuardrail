output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  value       = aws_apigatewayv2_api.this.api_endpoint
  description = "Base invoke URL."
}

output "execution_arn" {
  value = aws_apigatewayv2_api.this.execution_arn
}
