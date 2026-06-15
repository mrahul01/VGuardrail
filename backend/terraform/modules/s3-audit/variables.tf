variable "env" {
  type        = string
  description = "Environment name."
}

variable "account_id" {
  type        = string
  description = "AWS account id (bucket name uniqueness)."
}

variable "kms_key_arn" {
  type        = string
  description = "CMK ARN for bucket encryption."
}

variable "retention_years" {
  type        = number
  description = "Object Lock compliance retention in years."
  default     = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
