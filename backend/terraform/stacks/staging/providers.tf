provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "vguardrail"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
