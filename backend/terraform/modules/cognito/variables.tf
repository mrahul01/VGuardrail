variable "env" {
  type        = string
  description = "Environment name."
}

variable "region" {
  type        = string
  description = "AWS region (for the issuer URL output)."
}

variable "dashboard_callback_urls" {
  type        = list(string)
  description = "Allowed callback URLs for the dashboard."
  # Must match the redirect_uri the dashboard sends:
  # `${NEXT_PUBLIC_APP_URL}/api/auth/callback/cognito` (lib/auth/cognito-client.ts).
  default = ["http://localhost:3000/api/auth/callback/cognito"]
}

variable "dashboard_logout_urls" {
  type        = list(string)
  description = "Allowed logout URLs for the dashboard."
  # The dashboard logout redirects to `${appUrl}/login` (getHostedLogoutUrl).
  default = ["http://localhost:3000/login", "http://localhost:3000"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
