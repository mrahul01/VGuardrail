/**
 * Local-development auth bypass.
 *
 * When the environment variable `DISABLE_AUTH=true` is set, the
 * dashboard skips all Cognito/OAuth flows and uses a hardcoded
 * mock session.  This lets operators run the entire stack locally
 * without any cloud dependencies.
 */

export function isLocalAuthDisabled(): boolean {
  return process.env.DISABLE_AUTH === "true";
}

/** Mock user session used when auth is disabled. */
export const MOCK_USER_SESSION = {
  id: "u-dev-001",
  email: "admin@localhost.dev",
  role: "super_admin" as const,
  orgId: "local-org",
  orgName: "Local Dev Org",
  groups: ["super_admin", "org_admin", "auditor"],
};

/** Mock access token (not verified – backend ignores it in VG_DEV_CLAIMS mode). */
export const MOCK_ACCESS_TOKEN =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1LWRldi0wMDEiLCJleHAiOjQxMDI0NDc5OTl9.";

/** Mock refresh token. */
export const MOCK_REFRESH_TOKEN = "mock-refresh-token-local";

/** Mock ID token (not verified – session-store uses MOCK_USER_SESSION directly). */
export const MOCK_ID_TOKEN = MOCK_ACCESS_TOKEN;

/** How long the mock tokens are valid (30 days). */
export const MOCK_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;