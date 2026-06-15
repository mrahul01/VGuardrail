variable "env" {
  type        = string
  description = "Environment name (dev/staging/prod)."
}

variable "region" {
  type        = string
  description = "AWS region."
}

variable "artifacts_dir" {
  type        = string
  description = "Directory holding the per-function deployment zips (<name>.zip)."
}

variable "enrollment_secrets" {
  type        = map(string)
  description = "org_id => enrollment token, materialized into Secrets Manager."
  default     = {}
}

variable "policy_pubkey_b64" {
  type        = string
  description = "Base64 Ed25519 public key the policy-latest Lambda verifies bundles against (empty to skip)."
  default     = ""
}

variable "retention_years" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_actions" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
