#!/usr/bin/env bash
# Data-plane e2e against LocalStack: policy download, idempotent event ingestion,
# and chain integrity. Asserts on the Lambda responses and the DynamoDB state.
set -euo pipefail

ENDPOINT="http://localhost:4566"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
aws() { command aws --endpoint-url "$ENDPOINT" "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

invoke() { # <function> <payload-file> -> writes decoded body to stdout
  aws lambda invoke --function-name "$1" --payload "fileb://$2" "$TMP/out.json" >/dev/null
  python3 -c "import json,sys; print(json.load(open('$TMP/out.json')).get('body',''))"
}

# APIGW v2 event with dev-claim headers (no authorizer needed; VG_DEV_CLAIMS=1).
event() { # <method> <path> <body-json>
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
method, path, body = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
  "version": "2.0", "routeKey": f"{method} {path}", "rawPath": path,
  "headers": {"x-vg-device-id": "dev-1", "x-vg-org-id": "org-1", "content-type": "application/json"},
  "requestContext": {"http": {"method": method, "path": path}},
  "body": body, "isBase64Encoded": False
}))
PY
}

echo "== 1. policy download =="
event GET /policies/latest "" > "$TMP/policy.json"
POLICY=$(invoke policy-latest "$TMP/policy.json")
echo "$POLICY" | grep -q '"version":3' && echo "  ok: bundle v3 served" || { echo "  FAIL policy"; exit 1; }

echo "== 2. event upload =="
BATCH='{"events":[
  {"event_id":"e1","type":"PolicyEvaluated","timestamp_ms":100,"user_id":"u","device_id":"dev-1","decision":"warn","risk_level":"medium","classification":"internal","policy_version":3,"category":"company_confidential","reason":"Internal project codename matched confidential-content policy."},
  {"event_id":"e2","type":"PolicyEvaluated","timestamp_ms":200,"user_id":"u","device_id":"dev-1","decision":"block","risk_level":"critical","classification":"restricted","policy_version":3,"category":"secret","reason":"AWS access key detected in prompt."}
]}'
event POST /events/batch "$BATCH" > "$TMP/batch.json"
R1=$(invoke events-batch "$TMP/batch.json")
echo "$R1" | grep -q '"accepted":2' && echo "  ok: 2 accepted" || { echo "  FAIL upload: $R1"; exit 1; }

echo "== 3. idempotent retry =="
R2=$(invoke events-batch "$TMP/batch.json")
echo "$R2" | grep -q '"replayed":true' && echo "  ok: retry replayed" || { echo "  FAIL idempotency: $R2"; exit 1; }

echo "== 4. chain head persisted =="
HEAD=$(aws dynamodb get-item --table-name vguardrail-audit-dev \
  --key '{"PK":{"S":"DEVICE#dev-1"},"SK":{"S":"CHAINHEAD"}}' --query 'Item.count.N' --output text)
[ "$HEAD" = "2" ] && echo "  ok: chain length 2" || { echo "  FAIL chain head: $HEAD"; exit 1; }

echo "ALL E2E CHECKS PASSED"
