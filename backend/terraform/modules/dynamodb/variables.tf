variable "env" {
  type        = string
  description = "Environment name."
}

variable "kms_key_arn" {
  type        = string
  description = "CMK ARN for table encryption."
}

variable "deletion_protection" {
  type        = bool
  description = "Enable deletion protection (prod)."
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
