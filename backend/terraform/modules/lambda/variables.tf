variable "name" {
  type        = string
  description = "Short function name (e.g. health, register)."
}

variable "env" {
  type        = string
  description = "Environment name."
}

variable "filename" {
  type        = string
  description = "Path to the function deployment zip (cargo lambda build output)."
}

variable "environment" {
  type        = map(string)
  description = "Environment variables."
  default     = {}
}

variable "policy_json" {
  type        = string
  description = "Inline IAM policy JSON (least privilege). Null for none."
  default     = null
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type    = number
  default = 10
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  type        = string
  description = "CMK ARN for log-group encryption."
}

variable "tags" {
  type    = map(string)
  default = {}
}
