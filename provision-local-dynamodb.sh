#!/usr/bin/env bash
# ============================================================
#  provision-local-dynamodb.sh — Ensure the local DynamoDB
#  tables exist with the indexes the backend requires.
#
#  The control-plane (core) table MUST carry GSI1/GSI2/GSI3 —
#  the admin device/user/policy/exception queries use them
#  (see backend/terraform/modules/dynamodb/main.tf, the source
#  of truth). Without the GSIs those endpoints return 500.
#
#  Idempotent: if the core table already has all three GSIs it
#  is left untouched; otherwise it is (re)created. The audit
#  table is created if absent (its events live in an in-memory
#  dev store, so it needs no GSIs for local use).
#
#  Run this after a fresh checkout or any time ./dynamodb_data
#  was wiped, then ./seed-local-data.sh for demo content.
# ============================================================
set -euo pipefail

ENDPOINT="${DYNAMODB_ENDPOINT:-http://localhost:8000}"
CORE="${VG_CORE_TABLE:-vguardrail-core-local}"
AUDIT="${VG_AUDIT_TABLE:-vguardrail-audit-local}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-minioadmin}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-minioadmin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

ddb() { aws dynamodb --endpoint-url "$ENDPOINT" "$@"; }

core_gsis() {
  ddb describe-table --table-name "$CORE" 2>/dev/null \
    | python3 -c 'import sys,json
try: d=json.load(sys.stdin)["Table"]; print(",".join(sorted(g["IndexName"] for g in (d.get("GlobalSecondaryIndexes") or []))))
except Exception: print("__missing__")'
}

echo "Provisioning DynamoDB at $ENDPOINT"

CURRENT="$(core_gsis)"
if [ "$CURRENT" = "GSI1,GSI2,GSI3" ]; then
  echo "  core table '$CORE' already has GSI1/2/3 ✓"
else
  if [ "$CURRENT" != "__missing__" ]; then
    echo "  core table '$CORE' is missing GSIs ($CURRENT) — recreating"
    ddb delete-table --table-name "$CORE" >/dev/null 2>&1 || true
    sleep 2
  else
    echo "  core table '$CORE' absent — creating"
  fi
  ddb create-table --table-name "$CORE" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
      AttributeName=GSI2PK,AttributeType=S AttributeName=GSI2SK,AttributeType=S \
      AttributeName=GSI3PK,AttributeType=S AttributeName=GSI3SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
      'IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=GSI2,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=GSI3,KeySchema=[{AttributeName=GSI3PK,KeyType=HASH},{AttributeName=GSI3SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    >/dev/null
  echo "  core table '$CORE' created with GSI1/2/3 ✓"
fi

if ddb describe-table --table-name "$AUDIT" >/dev/null 2>&1; then
  echo "  audit table '$AUDIT' present ✓"
else
  ddb create-table --table-name "$AUDIT" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE >/dev/null
  echo "  audit table '$AUDIT' created ✓"
fi

echo "Done."
