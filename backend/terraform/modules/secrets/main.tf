# Per-org enrollment secrets gating device registration.
#
# Production secrets are created/rotated out-of-band; this module materializes the
# map provided in tfvars (e.g. a dev secret) so the register Lambda can validate
# them. The secret value is the full enrollment token "<org_id>.<random>".

resource "aws_secretsmanager_secret" "enrollment" {
  for_each    = var.enrollment_secrets
  name        = "${var.prefix}${each.key}"
  description = "VGuardrail enrollment secret for org ${each.key} (${var.env})."
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "enrollment" {
  for_each      = var.enrollment_secrets
  secret_id     = aws_secretsmanager_secret.enrollment[each.key].id
  secret_string = each.value
}
