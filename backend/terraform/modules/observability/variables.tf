variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "function_names" {
  type        = list(string)
  description = "Lambda function names to alarm on."
}

variable "api_id" {
  type        = string
  description = "HTTP API id for API metrics."
}

variable "alarm_actions" {
  type        = list(string)
  description = "SNS topic ARNs to notify on alarm (empty for none)."
  default     = []
}
