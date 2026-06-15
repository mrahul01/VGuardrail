#!/usr/bin/env bash
#
# VGuardrail — production deployment to dashboard.verisync.digital
#
# One command to: build+push images to ECR, apply the Terraform serving stack
# (ALB + ECS Fargate + Route53), and register the production Cognito callback
# URLs. Re-runnable (idempotent). REQUIRES the ACM cert for the domain to be
# ISSUED first (setup creates the request + DNS validation record).
#
#   ./deploy-prod.sh            # full deploy
#   ./deploy-prod.sh --plan     # build/push skipped; terraform plan only
#
# Billable: creates an ALB + 2 Fargate tasks. Review `terraform plan` first.
set -euo pipefail
cd "$(dirname "$0")"

REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
TF=backend/terraform/stacks/prod-dashboard
POOL=us-east-1_AYs9Ew21r
DASH_CLIENT=giu1mg97gf1du8ng8bp7ihgab
DOMAIN=dashboard.verisync.digital

log() { echo $'\e[32m==>\e[0m' "$*"; }

# 1. Pre-flight: cert must be issued.
CERT_ARN=$(aws acm list-certificates --region $REGION \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn" --output text)
[[ -n "$CERT_ARN" ]] || { echo "No ACM cert for $DOMAIN — run setup first."; exit 1; }
STATUS=$(aws acm describe-certificate --region $REGION --certificate-arn "$CERT_ARN" --query Certificate.Status --output text)
log "ACM cert: $CERT_ARN ($STATUS)"
[[ "$STATUS" == "ISSUED" ]] || echo "  (cert not yet ISSUED; terraform apply will fail until it is)"

# 2. Create JUST the ECR repos via Terraform first (so we can push images
#    before the ECS service that consumes them is created).
if [[ "${1:-}" != "--plan" ]]; then
  log "Terraform init + create ECR repos"
  ( cd "$TF" && terraform init -input=false && \
    terraform apply -input=false -auto-approve -var-file=prod.tfvars \
      -target=aws_ecr_repository.backend -target=aws_ecr_repository.dashboard )

  # 3. Build + push images.
  log "ECR login"
  aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ECR"
  log "Build + push backend"
  docker build -f backend/Dockerfile -t "$ECR/vguardrail/backend:latest" .
  docker push "$ECR/vguardrail/backend:latest"
  log "Build + push dashboard"
  docker build -f dashboard/Dockerfile -t "$ECR/vguardrail/dashboard:latest" .
  docker push "$ECR/vguardrail/dashboard:latest"
fi

# 4. Terraform.
log "Terraform init/$([[ "${1:-}" == "--plan" ]] && echo plan || echo apply)"
( cd "$TF" && terraform init -input=false && \
  if [[ "${1:-}" == "--plan" ]]; then terraform plan -var-file=prod.tfvars; \
  else terraform apply -input=false -auto-approve -var-file=prod.tfvars; fi )
[[ "${1:-}" == "--plan" ]] && exit 0

# 5. Register production Cognito callback/logout URLs (full-replace API: keep
#    localhost for dev too). Idempotent.
log "Updating Cognito callback/logout URLs for $DOMAIN"
aws cognito-idp update-user-pool-client --user-pool-id $POOL --client-id $DASH_CLIENT --region $REGION \
  --callback-urls \
    "https://$DOMAIN/api/auth/callback/cognito" \
    "http://localhost:3000/api/auth/callback/cognito" \
  --logout-urls \
    "https://$DOMAIN/login" "https://$DOMAIN" \
    "http://localhost:3000/login" "http://localhost:3000" \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --supported-identity-providers COGNITO \
  --generate-secret 2>/dev/null || \
aws cognito-idp update-user-pool-client --user-pool-id $POOL --client-id $DASH_CLIENT --region $REGION \
  --callback-urls "https://$DOMAIN/api/auth/callback/cognito" "http://localhost:3000/api/auth/callback/cognito" \
  --logout-urls "https://$DOMAIN/login" "https://$DOMAIN" "http://localhost:3000/login" "http://localhost:3000" \
  --allowed-o-auth-flows code --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client --supported-identity-providers COGNITO

log "Done. Dashboard: https://$DOMAIN"
log "Verify: curl -I https://$DOMAIN/login"
