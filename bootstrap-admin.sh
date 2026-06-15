#!/bin/bash
set -e

# Configuration
USER_POOL_ID=${1:-"us-east-1_JWlXXPwvY"}
ADMIN_EMAIL=${2:-"admin@vguardrail.local"}
TEMP_PASSWORD=${3:-"TempP@ssw0rd2026!"}
ORG_ID=${4:-"org-001"}
GROUP_NAME="org_admin"

echo "Bootstrapping user: $ADMIN_EMAIL"

# Check if user already exists
if aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$ADMIN_EMAIL" 2>/dev/null; then
    echo "User $ADMIN_EMAIL already exists."
else
    echo "Creating user $ADMIN_EMAIL..."
    aws cognito-idp admin-create-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --user-attributes Name=email,Value="$ADMIN_EMAIL" Name=email_verified,Value=true \
        --temporary-password "$TEMP_PASSWORD" \
        --message-action SUPPRESS
fi

# Set permanent password to avoid FORCE_CHANGE_PASSWORD
echo "Setting permanent password..."
aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --password "$TEMP_PASSWORD" \
    --permanent

# Assign org_id
echo "Assigning org_id..."
aws cognito-idp admin-update-user-attributes \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --user-attributes Name="custom:org_id",Value="$ORG_ID" || \
aws cognito-idp admin-update-user-attributes \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --user-attributes Name="org_id",Value="$ORG_ID"


# Assign group
echo "Assigning group $GROUP_NAME..."
aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --group-name "$GROUP_NAME"

# Verify attributes
echo "Verifying attributes..."
USER_INFO=$(aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$ADMIN_EMAIL")
echo "$USER_INFO"

echo "Bootstrap complete."
