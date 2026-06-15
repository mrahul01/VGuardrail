#!/usr/bin/env bash
# ============================================================
#  seed-local-data.sh — Seed demo control-plane data into the
#  local DynamoDB so every dashboard page shows content.
#
#  Items are written in the EXACT single-table format the Rust
#  backend reads (see backend/lambdas/crates/aws/src/dynamo.rs):
#    - PK = ORG#<org>, SK = <ENTITY>#<id>
#    - devices carry GSI3PK/GSI3SK (the device list queries GSI3)
#    - users carry GSI1PK/GSI1SK (email lookup index)
#
#  Audit events / violations are NOT seeded here: in dev mode the
#  backend keeps those in an in-memory store fed by live /scan
#  calls from the extension, so they populate as you use it.
#
#  Usage:  ./seed-local-data.sh            # org defaults to local-org
#          ./seed-local-data.sh my-org     # custom org id
# ============================================================
set -euo pipefail

ORG="${1:-local-org}"
ENDPOINT="${DYNAMODB_ENDPOINT:-http://localhost:8000}"
TABLE="${VG_CORE_TABLE:-vguardrail-core-local}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-minioadmin}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-minioadmin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

NOW_MS="$(($(date +%s) * 1000))"
DAY_MS=86400000

put() { aws dynamodb put-item --table-name "$TABLE" --endpoint-url "$ENDPOINT" --item "$1" >/dev/null; }

echo "Seeding demo data into $TABLE (org=$ORG) at $ENDPOINT"

# ── Devices ──────────────────────────────────────────────────────────────
device() {
  local id="$1" host="$2" plat="$3" ver="$4" status="$5" seen_ms="$6" user="$7" model="$8" os="$9" ip="${10}"
  put "$(cat <<JSON
{
  "PK":{"S":"ORG#$ORG"}, "SK":{"S":"DEVICE#$id"},
  "GSI3PK":{"S":"ORG#$ORG"}, "GSI3SK":{"S":"DEVICE#$seen_ms#$id"},
  "GSI1PK":{"S":"DEVICE#$id"}, "GSI1SK":{"S":"DEVICE"},
  "device_id":{"S":"$id"}, "org_id":{"S":"$ORG"},
  "hostname":{"S":"$host"}, "hostname_full":{"S":"$host.local"},
  "platform":{"S":"$plat"}, "os_version":{"S":"$os"},
  "model":{"S":"$model"},
  "agent_version":{"S":"$ver"}, "status":{"S":"$status"},
  "ip_address":{"S":"$ip"}, "last_user":{"S":"$user"},
  "enrolled_by":{"S":"admin@localhost.dev"},
  "registered_at_ms":{"N":"$((NOW_MS - 7 * DAY_MS))"},
  "last_seen_ms":{"N":"$seen_ms"}, "chain_count":{"N":"3"}
}
JSON
)"
  echo "  device  $id ($status)"
}

device "ext-chrome-01" "alice-macbook" "chrome/120 (darwin)"  "0.1.0" "active"   "$((NOW_MS - 3600000))"    "alice" "MacBookPro18,3"   "macOS 15.5 (24F74)"      "10.0.0.5"
device "ext-edge-02"   "bob-thinkpad"  "edge/120 (windows)"   "0.1.0" "active"   "$((NOW_MS - 2 * DAY_MS))" "bob"   "ThinkPad X1 G11"  "Windows 11 23H2"         "10.0.0.17"
device "ext-safari-03" "carol-imac"    "safari/17 (darwin)"   "0.1.0" "inactive" "$((NOW_MS - 9 * DAY_MS))" "carol" "iMac21,1"         "macOS 14.7 (23H124)"     "10.0.0.31"

# ── Policies ─────────────────────────────────────────────────────────────
policy() {
  local v="$1" status="$2" pub_ms="$3" name="$4" action="$5" rules="$6"
  put "$(cat <<JSON
{
  "PK":{"S":"ORG#$ORG"}, "SK":{"S":"POLICY#v$v"},
  "version":{"N":"$v"}, "status":{"S":"$status"},
  "published_at_ms":{"N":"$pub_ms"},
  "policy_id":{"S":"pol-default"}, "name":{"S":"$name"},
  "org_id":{"S":"$ORG"}, "default_action":{"S":"$action"},
  "rule_count":{"N":"$rules"}
}
JSON
)"
  echo "  policy  v$v ($status)"
}

policy 1 "archived"  "$((NOW_MS - 30 * DAY_MS))" "Default Security Policy" "warn"  "4"
policy 2 "published" "$((NOW_MS - 5 * DAY_MS))"  "Default Security Policy" "block" "7"

# ── Device inventory (processes + extensions shown on the device page) ──
inventory() {
  local id="$1" payload="$2"
  # The backend stores the snapshot as a JSON string in `payload`; python
  # handles the quote escaping that a raw heredoc would get wrong.
  put "$(python3 -c '
import json, sys
item = {
  "PK": {"S": "ORG#" + sys.argv[1]}, "SK": {"S": "INVENTORY#" + sys.argv[2]},
  "device_id": {"S": sys.argv[2]}, "org_id": {"S": sys.argv[1]},
  "collected_at_ms": {"N": sys.argv[3]},
  "payload": {"S": sys.argv[4]},
}
print(json.dumps(item))
' "$ORG" "$id" "$NOW_MS" "$payload")"
  echo "  invent  $id"
}

proc() { # pid name user started_ms is_app [command] [ai_category] [status]
  printf '{"pid":%s,"name":"%s","user":"%s","started_at_ms":%s,"is_app":%s' "$1" "$2" "$3" "$4" "$5"
  [ -n "${6:-}" ] && printf ',"command":"%s"' "$6"
  [ -n "${7:-}" ] && printf ',"ai_category":"%s","status":"%s"' "$7" "${8:-running}"
  printf '}'
}
aiproc() { # name ai_category command — installed-but-not-running AI item
  printf '{"pid":0,"name":"%s","is_app":%s,"command":"%s","ai_category":"%s","status":"installed"}' \
    "$1" "$([ "${3##*.app}" != "$3" ] && echo true || echo false)" "$3" "$2"
}
ext() { # browser id name version
  printf '{"browser":"%s","extension_id":"%s","name":"%s","version":"%s"}' "$1" "$2" "$3" "$4"
}

inventory "ext-chrome-01" "$(cat <<JSON
{"device_id":"ext-chrome-01","collected_at_ms":$NOW_MS,
 "processes":[$(proc 312 "Google Chrome" alice $((NOW_MS - 5 * 3600000)) true "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" browser),
  $(proc 488 "Slack" alice $((NOW_MS - 8 * 3600000)) true "/Applications/Slack.app/Contents/MacOS/Slack"),
  $(proc 530 "Visual Studio Code" alice $((NOW_MS - 3 * 3600000)) true "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" ai_ide),
  $(proc 4821 "Cursor" alice $((NOW_MS - 4 * 3600000)) true "/Applications/Cursor.app/Contents/MacOS/Cursor" ai_ide),
  $(proc 5120 "claude" alice $((NOW_MS - 50 * 60000)) false "claude --model opus" ai_cli),
  $(proc 871 "Terminal" alice $((NOW_MS - 2 * 3600000)) true "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
  $(proc 92 "mds_stores" root $((NOW_MS - 7 * DAY_MS)) false "/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Versions/A/Support/mds_stores"),
  $(proc 143 "launchd" root $((NOW_MS - 7 * DAY_MS)) false "/sbin/launchd"),
  $(aiproc "ChatGPT" ai_desktop "/Applications/ChatGPT.app"),
  $(aiproc "ollama" ai_cli "/opt/homebrew/bin/ollama")],
 "extensions":[$(ext chrome "vg-chrome-ext-id-0001" "VGuardrail DLP" "0.1.0"),
  $(ext chrome "cjpalhdlnbpafiamejdnhcphjbkeiagm" "uBlock Origin" "1.58.0"),
  $(ext chrome "nngceckbapebfimnlniiiahkandclblb" "Bitwarden" "2025.5.1")]}
JSON
)"

inventory "ext-edge-02" "$(cat <<JSON
{"device_id":"ext-edge-02","collected_at_ms":$NOW_MS,
 "processes":[$(proc 1204 "Microsoft Edge" bob $((NOW_MS - 6 * 3600000)) true "" browser),
  $(proc 2210 "Microsoft Teams" bob $((NOW_MS - 6 * 3600000)) true),
  $(proc 3300 "Excel" bob $((NOW_MS - 90 * 60000)) true),
  $(proc 410 "svchost" SYSTEM $((NOW_MS - 2 * DAY_MS)) false),
  $(aiproc "GitHub Copilot" ai_desktop "C:\\\\Program Files\\\\GitHub Copilot\\\\Copilot.exe")],
 "extensions":[$(ext edge "vg-edge-ext-id-0002" "VGuardrail DLP" "0.1.0"),
  $(ext edge "jmjflgjpcpepeafmmgdpfkogkghcpiha" "Edge Translate" "3.1.2")]}
JSON
)"

inventory "ext-safari-03" "$(cat <<JSON
{"device_id":"ext-safari-03","collected_at_ms":$((NOW_MS - 9 * DAY_MS)),
 "processes":[$(proc 640 "Safari" carol $((NOW_MS - 9 * DAY_MS)) true "" browser),
  $(proc 712 "Mail" carol $((NOW_MS - 9 * DAY_MS)) true)],
 "extensions":[$(ext safari "com.vguardrail.connector.safari" "VGuardrail DLP" "0.1.0")]}
JSON
)"

# ── Exceptions ───────────────────────────────────────────────────────────
exception() {
  local id="$1" rule="$2" status="$3" req_ms="$4"
  put "$(cat <<JSON
{
  "PK":{"S":"ORG#$ORG"}, "SK":{"S":"EXCEPTION#$id"},
  "exception_id":{"S":"$id"}, "rule_id":{"S":"$rule"},
  "status":{"S":"$status"}, "requested_at_ms":{"N":"$req_ms"},
  "org_id":{"S":"$ORG"}, "requested_by":{"S":"alice@local"},
  "policy_version":{"N":"2"}, "reason":{"S":"False positive on internal hostnames"}
}
JSON
)"
  echo "  except  $id ($status)"
}

exception "exc-001" "dev-pii-ssn"  "pending"  "$((NOW_MS - 3600000))"
exception "exc-002" "dev-secret-aws" "approved" "$((NOW_MS - 4 * DAY_MS))"

# ── Users ────────────────────────────────────────────────────────────────
user() {
  local id="$1" email="$2" role="$3" status="$4" login_ms="$5"
  put "$(cat <<JSON
{
  "PK":{"S":"ORG#$ORG"}, "SK":{"S":"USER#$id"},
  "GSI1PK":{"S":"EMAIL#$email"}, "GSI1SK":{"S":"ORG#$ORG"},
  "user_id":{"S":"$id"}, "email":{"S":"$email"},
  "role":{"S":"$role"}, "status":{"S":"$status"},
  "last_login_ms":{"N":"$login_ms"}
}
JSON
)"
  echo "  user    $email ($role)"
}

user "u-admin-001" "admin@localhost.dev" "super_admin" "active"  "$((NOW_MS - 3600000))"
user "u-auditor-01" "auditor@local"      "auditor"     "active"  "$((NOW_MS - 2 * DAY_MS))"
user "u-disabled-1" "former@local"        "org_admin"   "disabled" "$((NOW_MS - 40 * DAY_MS))"

echo "Done. Reload the dashboard to see seeded devices, policies, exceptions, and users."
