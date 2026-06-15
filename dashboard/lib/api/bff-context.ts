// BFF request context utilities.
//
// Each BFF route handler resolves a `BffContext` (currently a mock viewer
// session) and then runs any `canPerformAction(...)` checks via
// `withRbac(...)` before touching repositories.

import { cookies } from "next/headers";
import { canPerformAction } from "@/lib/auth/rbac";
import type { Role, UserSession } from "@/types";

export const SESSION_COOKIE = "vg_session";

export class BffAuthError extends Error {
  public readonly status: number;
  public readonly code: string;
  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BffAuthError";
    this.status = status;
    this.code = code;
  }
}

const MOCK_VIEWER: UserSession = {
  id: "u-001",
  email: "admin@corp.example.com",
  role: "org_admin",
  orgId: "org-default",
  orgName: "Acme Corp",
  groups: ["org_admin", "auditor"],
};

/**
 * Read the caller's session from cookies. In production this would validate
 * the session JWT and return the decoded claims. In the mock-backed
 * dashboard we surface the seeded org_admin so RBAC checks are exercised
 * end-to-end.
 */
export async function getBffSession(): Promise<UserSession> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return MOCK_VIEWER;
  }
  try {
    const parsed = JSON.parse(raw) as UserSession;
    if (typeof parsed.role !== "string") {
      return MOCK_VIEWER;
    }
    return parsed;
  } catch {
    return MOCK_VIEWER;
  }
}

export interface BffContext {
  readonly session: UserSession;
  readonly role: Role;
  readonly orgId: string;
}

export async function getBffContext(): Promise<BffContext> {
  const session = await getBffSession();
  return { session, role: session.role, orgId: session.orgId };
}

/** Throw a typed BFF error if the caller may not perform the action. */
export function requireAction(role: Role, action: string): void {
  if (!canPerformAction(role, action)) {
    throw new BffAuthError(403, "forbidden", `Role '${role}' cannot perform '${action}'`);
  }
}

/** Read-only roles cannot write. Used for safe default-check in mutations. */
export const READ_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>(["viewer", "auditor"]);

export function isReadOnly(role: Role): boolean {
  return READ_ONLY_ROLES.has(role);
}
