#!/bin/bash
set -e

# Configuration
CORE_TABLE=${1:-"vguardrail-core-prod"}
AUDIT_TABLE=${2:-"vguardrail-audit-prod"}

echo "Seeding data into Core Table: $CORE_TABLE"
echo "Seeding data into Audit Table: $AUDIT_TABLE"

# 1. Seed Policy
aws dynamodb put-item \
    --table-name "$CORE_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "POLICY#pol-default"},
        "type": {"S": "policy"},
        "name": {"S": "Default Security Policy"},
        "content": {"S": "{\"rules\": [{\"id\": \"r1\", \"action\": \"deny\"}]}"},
        "version": {"N": "1"},
        "status": {"S": "published"},
        "updated_at": {"S": "2026-06-08T00:00:00Z"}
    }'

# 2. Seed Device
aws dynamodb put-item \
    --table-name "$CORE_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "DEVICE#dev-test-01"},
        "type": {"S": "device"},
        "hostname": {"S": "test-macbook-pro"},
        "platform": {"S": "darwin"},
        "status": {"S": "active"},
        "last_seen": {"S": "2026-06-08T00:00:00Z"}
    }'

# 3. Seed Exception
aws dynamodb put-item \
    --table-name "$CORE_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "EXCEPTION#exc-001"},
        "type": {"S": "exception"},
        "device_id": {"S": "dev-test-01"},
        "rule_id": {"S": "r1"},
        "status": {"S": "approved"},
        "expires_at": {"S": "2026-12-31T23:59:59Z"}
    }'

# 4. Seed User
aws dynamodb put-item \
    --table-name "$CORE_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "USER#admin@vguardrail.local"},
        "type": {"S": "user"},
        "email": {"S": "admin@vguardrail.local"},
        "role": {"S": "org_admin"},
        "status": {"S": "active"}
    }'

# 5. Seed Violations (Audit Table) — spread across policy categories so the
#    dashboard's category filter and "Top Policy Categories" card have data.
aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "VIOLATION#2026-06-08T00:00:00Z#viol-001"},
        "type": {"S": "violation"},
        "device_id": {"S": "dev-test-01"},
        "rule_id": {"S": "r1"},
        "severity": {"S": "high"},
        "category": {"S": "secret"},
        "reason": {"S": "AWS access key detected in prompt. Blocked by policy."},
        "details": {"S": "Unauthorized process execution blocked."}
    }'

aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "VIOLATION#2026-06-08T01:00:00Z#viol-002"},
        "type": {"S": "violation"},
        "device_id": {"S": "dev-test-01"},
        "rule_id": {"S": "r2"},
        "severity": {"S": "critical"},
        "category": {"S": "pii"},
        "reason": {"S": "Social security number detected in prompt. Blocked by policy."},
        "details": {"S": "PII exfiltration attempt blocked."}
    }'

aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "VIOLATION#2026-06-08T02:00:00Z#viol-003"},
        "type": {"S": "violation"},
        "device_id": {"S": "dev-test-01"},
        "rule_id": {"S": "r3"},
        "severity": {"S": "high"},
        "category": {"S": "company_confidential"},
        "reason": {"S": "Internal project codename matched confidential-content policy. Review required."},
        "details": {"S": "Confidential content shared with external AI provider."}
    }'

aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "VIOLATION#2026-06-08T03:00:00Z#viol-004"},
        "type": {"S": "violation"},
        "device_id": {"S": "dev-test-01"},
        "rule_id": {"S": "r4"},
        "severity": {"S": "medium"},
        "category": {"S": "source_code"},
        "reason": {"S": "Proprietary source code detected in prompt. Warned by policy."},
        "details": {"S": "Source code paste flagged for review."}
    }'

# 6. Seed Audit Records
aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "EVENT#2026-06-08T00:00:00Z#evt-001"},
        "type": {"S": "event"},
        "device_id": {"S": "dev-test-01"},
        "action": {"S": "policy_evaluated"},
        "result": {"S": "deny"},
        "category": {"S": "secret"},
        "reason": {"S": "AWS access key detected in prompt. Blocked by policy."}
    }'

aws dynamodb put-item \
    --table-name "$AUDIT_TABLE" \
    --item '{
        "pk": {"S": "ORG#org-001"},
        "sk": {"S": "EVENT#2026-06-08T04:00:00Z#evt-002"},
        "type": {"S": "event"},
        "device_id": {"S": "dev-test-01"},
        "action": {"S": "policy_evaluated"},
        "result": {"S": "warn"},
        "category": {"S": "prompt_injection"},
        "reason": {"S": "Possible jailbreak phrasing detected. User warned."}
    }'

echo "Data seeding complete."
