output "prefix" {
  value = var.prefix
}

output "secret_arns" {
  value       = [for s in aws_secretsmanager_secret.enrollment : s.arn]
  description = "ARNs of the created enrollment secrets."
}

output "secret_arn_wildcard" {
  value       = "arn:aws:secretsmanager:*:*:secret:${var.prefix}*"
  description = "Wildcard ARN for the register Lambda's read policy."
}
