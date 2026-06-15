module "stack" {
  source = "../../modules/stack"

  env                 = var.env
  region              = var.region
  artifacts_dir       = var.artifacts_dir
  enrollment_secrets  = var.enrollment_secrets
  policy_pubkey_b64   = var.policy_pubkey_b64
  deletion_protection = true
  log_retention_days  = 365
}
