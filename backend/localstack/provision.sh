#!/usr/bin/env bash
# Provisions LocalStack with the data-plane resources and deploys the functions.
# Cognito (register) needs LocalStack Pro / real AWS; this covers the
# DynamoDB/S3 data plane (policy download + event ingestion).
set -euo pipefail

ENDPOINT="http://localhost:4566"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
aws() { command aws --endpoint-url "$ENDPOINT" "$@"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIPS="$ROOT/lambdas/target/lambda-zips"
CORE=vguardrail-core-dev
AUDIT=vguardrail-audit-dev
BUCKET=vguardrail-audit-dev-000000000000

echo "== DynamoDB tables =="
aws dynamodb create-table --table-name "$CORE" \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST >/dev/null || true
aws dynamodb create-table --table-name "$AUDIT" \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST >/dev/null || true

echo "== S3 bucket =="
aws s3api create-bucket --bucket "$BUCKET" >/dev/null || true

echo "== seed a policy bundle for org-1 =="
aws dynamodb put-item --table-name "$CORE" --item '{
  "PK": {"S":"ORG#org-1"}, "SK": {"S":"POLICY#LATEST"},
  "version": {"N":"3"},
  "bundle_json": {"S":"{\"schema\":\"vguardrail.policy/v1\",\"version\":3,\"org_id\":\"org-1\"}"}
}' >/dev/null

echo "== deploy functions =="
ENV_JSON='{"Variables":{"VG_CORE_TABLE":"'$CORE'","VG_AUDIT_TABLE":"'$AUDIT'","VG_AUDIT_BUCKET":"'$BUCKET'","VG_USER_POOL_ID":"x","VG_APP_CLIENT_ID":"x","VG_DEV_CLAIMS":"1"}}'
for fn in policy-latest events-batch health; do
  aws lambda create-function --function-name "$fn" \
    --runtime provided.al2023 --handler bootstrap --architectures arm64 \
    --role arn:aws:iam::000000000000:role/irrelevant \
    --zip-file "fileb://$ZIPS/$fn.zip" \
    --environment "$ENV_JSON" >/dev/null || \
  aws lambda update-function-code --function-name "$fn" --zip-file "fileb://$ZIPS/$fn.zip" >/dev/null
  echo "deployed $fn"
done
echo "provisioned."
