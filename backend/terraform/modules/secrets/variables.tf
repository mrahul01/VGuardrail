variable "env" {
  type        = string
  description = "Environment name."
}

variable "prefix" {
  type        = string
  description = "Secret name prefix (matches VG_ENROLLMENT_PREFIX)."
  default     = "vguardrail/enrollment/"
}

variable "enrollment_secrets" {
  type        = map(string)
  description = "Map of org_id => enrollment token value."
  default     = {}
}

variable "kms_key_arn" {
  type        = string
  description = "CMK ARN for secret encryption."
}

variable "tags" {
  type    = map(string)
  default = {}
}
