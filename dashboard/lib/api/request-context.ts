import { cookies } from "next/headers";
import type { Role, UserSession } from "@/types/auth";
import { getOrRefreshStoredSession } from "@/lib/auth/session-store";

export const SESSION_COOKIE = "vg_session";

const ROLES: ReadonlySet<Role> = new Set([
  "super_admin",
  "org_admin",
  "auditor",
  "viewer",
]);

const MOCK_SESSION: UserSession = {
  id: "u-001",
  email: "admin@corp.example.com",
  role: "org_admin",
  orgId: "org-default",
  orgName: "Acme Corp",
  groups: ["org_admin", "auditor"],
};

export interface RequestContext {
  readonly session: UserSession;
  readonly role: Role;
  readonly orgId: string;
  readonly requestId: string;
}

export function allowMockAuth(): boolean {
  return process.env.VG_AUTH_MODE === "mock" || process.env.NODE_ENV === "test";
}

function isSession(value: Partial<UserSession>): value is UserSession {
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.orgId === "string" &&
    typeof value.orgName === "string" &&
    Array.isArray(value.groups) &&
    typeof value.role === "string" &&
    ROLES.has(value.role as Role)
  );
}

export async function extractRequestContext(
  request?: Request
): Promise<RequestContext> {
  const requestId =
    request?.headers.get("x-request-id") ?? `req-${Date.now().toString(36)}`;

  if (!allowMockAuth()) {
    const stored = await getOrRefreshStoredSession();
    if (stored) {
      return {
        session: stored.session,
        role: stored.session.role,
        orgId: stored.session.orgId,
        requestId,
      };
    }
    throw new Error("Authentication required");
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  let session = MOCK_SESSION;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<UserSession>;
      if (isSession(parsed)) session = parsed;
    } catch {
      session = MOCK_SESSION;
    }
  } else {
    const stored = await getOrRefreshStoredSession();
    if (stored) session = stored.session;
  }

  if (session) {
    return {
      session,
      role: session.role,
      orgId: session.orgId,
      requestId,
    };
  }

  throw new Error("Authentication required");
}
