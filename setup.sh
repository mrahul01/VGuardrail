#!/usr/bin/env bash
#
# VGuardrail — one-command local bootstrap.
#
#   ./setup.sh                # build + start the whole stack, wait for health
#   ./setup.sh --bootstrap    # also (re)create the dev admin user in Cognito
#   ./setup.sh --down         # stop the stack
#
# Brings up the complete platform on a clean machine:
#   * Rust backend         → http://localhost:8080  (internal; /health public)
#   * Next.js dashboard    → http://localhost:3000
#
# Requirements: Docker (running), AWS CLI v2 with credentials for the dev
# account (the backend uses the default SDK credential chain against the live
# dev DynamoDB/S3/Cognito resources named in .env).
set -euo pipefail
cd "$(dirname "$0")"

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; RST=$'\e[0m'
log()  { echo "${GRN}==>${RST} $*"; }
warn() { echo "${YLW}!! ${RST} $*"; }
die()  { echo "${RED}xx ${RST} $*" >&2; exit 1; }

# ── 0. flags ────────────────────────────────────────────────────────────────
DO_BOOTSTRAP=0
if [[ "${1:-}" == "--down" ]]; then
  log "Stopping the stack…"; docker compose down; exit 0
fi
[[ "${1:-}" == "--bootstrap" ]] && DO_BOOTSTRAP=1

# ── 1. prerequisites ────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker not found"
docker info >/dev/null 2>&1 || die "Docker daemon is not running — start Docker Desktop and retry."
command -v aws >/dev/null || die "aws CLI not found (needed for credentials + bootstrap)"
[[ -f .env ]] || die ".env not found (expected resource IDs for the dev stack)"

# ── 2. AWS credentials → environment (consumed by docker-compose.override.yml)
log "Resolving AWS credentials from the default chain…"
if aws configure export-credentials --format env >/tmp/vg_aws_env 2>/dev/null; then
  # shellcheck disable=SC1091
  set -a; source /tmp/vg_aws_env; set +a
else
  warn "aws configure export-credentials unsupported; relying on ambient AWS_* env."
fi
[[ -n "${AWS_ACCESS_KEY_ID:-}" ]] || die "No AWS credentials available."
aws sts get-caller-identity >/dev/null || die "AWS credentials are invalid/expired."
log "AWS account: $(aws sts get-caller-identity --query Account --output text)"

# ── 3. dev override (publishes ports + injects creds) ───────────────────────
if [[ ! -f docker-compose.override.yml ]]; then
  log "Writing docker-compose.override.yml (dev ports + AWS creds)…"
  cat > docker-compose.override.yml <<'YML'
services:
  backend:
    ports: ["8080:8080"]
    environment:
      AWS_ACCESS_KEY_ID: "${AWS_ACCESS_KEY_ID}"
      AWS_SECRET_ACCESS_KEY: "${AWS_SECRET_ACCESS_KEY}"
      AWS_SESSION_TOKEN: "${AWS_SESSION_TOKEN:-}"
  dashboard:
    ports: ["3000:3000"]
YML
fi

# ── 4. optional: (re)create the dev admin user ──────────────────────────────
if [[ "$DO_BOOTSTRAP" == "1" ]]; then
  log "Bootstrapping dev admin user in Cognito…"
  # shellcheck disable=SC1091
  source .env
  ./bootstrap-admin.sh "${VG_USER_POOL_ID}" admin@vguardrail.local 'TempP@ssw0rd2026!' org-001
fi

# ── 5. build + start ────────────────────────────────────────────────────────
log "Building images…"; docker compose build
log "Starting stack…";  docker compose up -d

# ── 6. wait for health ──────────────────────────────────────────────────────
log "Waiting for backend /health…"
for i in $(seq 1 30); do
  if curl -fsS -m 3 http://localhost:8080/health >/dev/null 2>&1; then break; fi
  [[ $i == 30 ]] && die "backend did not become healthy — see: docker compose logs backend"
  sleep 2
done
log "Waiting for dashboard…"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://localhost:3000/login || true)
  [[ "$code" == "200" ]] && break
  [[ $i == 30 ]] && die "dashboard did not respond — see: docker compose logs dashboard"
  sleep 2
done

echo
log "${GRN}VGuardrail is up.${RST}"
echo "   Dashboard : http://localhost:3000   (log in via Cognito Hosted UI)"
echo "   Backend   : http://localhost:8080/health"
echo "   Admin     : admin@vguardrail.local / TempP@ssw0rd2026!  (run with --bootstrap to (re)create)"
echo "   Logs      : docker compose logs -f"
echo "   Stop      : ./setup.sh --down"
