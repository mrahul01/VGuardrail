variable "env" {
  type        = string
  description = "Environment name."
}

variable "jwt_issuer" {
  type        = string
  description = "Cognito issuer URL."
}

variable "jwt_audience" {
  type        = string
  description = "Cognito app client id (JWT audience)."
}

variable "routes" {
  type = map(object({
    invoke_arn    = string
    function_name = string
    authorized    = bool
  }))
  description = "Map of route_key (e.g. \"POST /events/batch\") to its Lambda + auth flag."
}

variable "access_log_group_arn" {
  type        = string
  description = "CloudWatch log group ARN for access logs."
}

variable "throttle_burst" {
  type    = number
  default = 200
}

variable "throttle_rate" {
  type    = number
  default = 100
}

variable "tags" {
  type    = map(string)
  default = {}
}
