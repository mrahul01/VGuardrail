# CloudWatch alarms (per-function errors/throttles, API 5xx) and a dashboard.

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(var.function_names)
  alarm_name          = "${each.key}-errors-${var.env}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = each.key }
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = toset(var.function_names)
  alarm_name          = "${each.key}-throttles-${var.env}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = each.key }
  alarm_actions       = var.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "vguardrail-api-5xx-${var.env}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { ApiId = var.api_id }
  alarm_actions       = var.alarm_actions
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "vguardrail-${var.env}"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "Lambda invocations / errors"
          region = var.region
          metrics = concat(
            [for f in var.function_names : ["AWS/Lambda", "Invocations", "FunctionName", f]],
            [for f in var.function_names : ["AWS/Lambda", "Errors", "FunctionName", f]]
          )
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title   = "API requests / latency"
          region  = var.region
          metrics = [["AWS/ApiGateway", "Count", "ApiId", var.api_id], ["AWS/ApiGateway", "Latency", "ApiId", var.api_id]]
        }
      }
    ]
  })
}
