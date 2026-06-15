output "core_table_name" {
  value = aws_dynamodb_table.core.name
}

output "core_table_arn" {
  value = aws_dynamodb_table.core.arn
}

output "audit_table_name" {
  value = aws_dynamodb_table.audit.name
}

output "audit_table_arn" {
  value = aws_dynamodb_table.audit.arn
}
