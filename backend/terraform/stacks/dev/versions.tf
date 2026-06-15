terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state (configure per account before `terraform init`).
  # backend "s3" {
  #   bucket         = "vguardrail-tfstate-<account_id>"
  #   key            = "audit-cloud/dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "vguardrail-tflock"
  #   encrypt        = true
  # }
}
