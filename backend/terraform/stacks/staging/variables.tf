variable "env" {
  type    = string
  default = "staging"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "artifacts_dir" {
  type        = string
  description = "Directory with the built function zips."
  default     = "../../../lambdas/target/lambda-zips"
}

variable "enrollment_secrets" {
  type    = map(string)
  default = {}
}

variable "policy_pubkey_b64" {
  type    = string
  default = ""
}
