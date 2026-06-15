# Reusable single-function module: Rust (provided.al2023, arm64) Lambda with a
# least-privilege role, KMS-encrypted log group, and an inline policy.

resource "aws_iam_role" "this" {
  name = "vguardrail-${var.name}-${var.env}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

# Basic execution (CloudWatch Logs).
resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Least-privilege inline policy supplied by the caller (DynamoDB/S3/Cognito/etc).
resource "aws_iam_role_policy" "inline" {
  count  = var.policy_json == null ? 0 : 1
  name   = "vguardrail-${var.name}-${var.env}-inline"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/vguardrail-${var.name}-${var.env}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_lambda_function" "this" {
  function_name = "vguardrail-${var.name}-${var.env}"
  role          = aws_iam_role.this.arn
  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]
  memory_size   = var.memory_size
  timeout       = var.timeout

  filename         = var.filename
  source_code_hash = try(filebase64sha256(var.filename), null)

  environment {
    variables = var.environment
  }

  depends_on = [aws_cloudwatch_log_group.this]
  tags       = var.tags
}
