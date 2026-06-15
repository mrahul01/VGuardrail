variable "env" {
  type        = string
  description = "Environment name (dev/staging/prod)."
}

variable "account_id" {
  type        = string
  description = "AWS account id (for the key policy root principal)."
}

variable "region" {
  type        = string
  description = "AWS region (for the CloudWatch Logs service principal)."
}

variable "tags" {
  type        = map(string)
  description = "Resource tags."
  default     = {}
}
