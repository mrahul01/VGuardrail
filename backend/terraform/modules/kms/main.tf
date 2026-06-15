# Customer-managed KMS key encrypting DynamoDB, S3, CloudWatch Logs, and Secrets.

resource "aws_kms_key" "this" {
  description             = "VGuardrail ${var.env} CMK"
  enable_key_rotation     = true
  deletion_window_in_days = 7

  # Allow CloudWatch Logs to use the key for log-group encryption.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableRoot"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
      }
    ]
  })

  tags = var.tags
}

resource "aws_kms_alias" "this" {
  name          = "alias/vguardrail-${var.env}"
  target_key_id = aws_kms_key.this.key_id
}
