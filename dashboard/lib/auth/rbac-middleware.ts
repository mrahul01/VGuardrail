import type { Role } from "@/types/auth";
import { canCreateUser, canPerformAction } from "@/lib/auth/rbac";
import { forbiddenError } from "@/lib/api/errors";
import type { RequestContext } from "@/lib/api/request-context";

export type Permission = "read" | "write" | "audit" | "settings" | "users";

interface RoutePermission {
  readonly method: string;
  readonly path: RegExp;
  readonly permission: Permission;
  readonly action?: string;
}

const ROUTE_PERMISSIONS: readonly RoutePermission[] = [
  { method: "GET", path: /^\/api\/dashboard(?:\/stats)?$/, permission: "read" },
  { method: "GET", path: /^\/api\/devices(?:\/[^/]+)?$/, permission: "read" },
  { method: "DELETE", path: /^\/api\/devices\/[^/]+$/, permission: "write", action: "deactivate:device" },
  { method: "GET", path: /^\/api\/violations(?:\/[^/]+)?$/, permission: "read", action: "view:violations" },
  { method: "GET", path: /^\/api\/policies(?:\/[^/]+)?$/, permission: "read" },
  { method: "POST", path: /^\/api\/policies$/, permission: "write", action: "create:policy" },
  { method: "PATCH", path: /^\/api\/policies\/[^/]+$/, permission: "write", action: "update:policy" },
  { method: "GET", path: /^\/api\/exceptions(?:\/[^/]+)?$/, permission: "read" },
  { method: "POST", path: /^\/api\/exceptions$/, permission: "write", action: "create:exception" },
  { method: "POST", path: /^\/api\/exceptions\/[^/]+$/, permission: "write", action: "approve:exception" },
  { method: "GET", path: /^\/api\/audit(?:\/[^/]+)?$/, permission: "audit", action: "view:audit" },
  { method: "GET", path: /^\/api\/users(?:\/[^/]+)?$/, permission: "users" },
  { method: "POST", path: /^\/api\/users$/, permission: "users" },
  { method: "DELETE", path: /^\/api\/users\/[^/]+$/, permission: "settings", action: "manage:settings" },
  { method: "GET", path: /^\/api\/settings$|^\/api\/org$/, permission: "settings" },
  { method: "PATCH", path: /^\/api\/settings$|^\/api\/org$/, permission: "settings", action: "manage:settings" },
];

export function routePermissionFor(method: string, path: string): RoutePermission | null {
  return (
    ROUTE_PERMISSIONS.find(
      (entry) => entry.method === method.toUpperCase() && entry.path.test(path)
    ) ?? null
  );
}

export function authorizeRoute(
  context: RequestContext,
  method: string,
  path: string
): void {
  const role = context.role;
  const mapping = routePermissionFor(method, path);
  if (!mapping) return;
  if (role === "super_admin") return;
  if (mapping.action && !canPerformAction(role, mapping.action)) {
    throw forbiddenError(`Role '${role}' cannot perform '${mapping.action}'`);
  }
  if (role === "viewer" && mapping.permission !== "read") {
    throw forbiddenError("Viewer role is read-only");
  }
  if (role === "auditor" && !["read", "audit"].includes(mapping.permission)) {
    throw forbiddenError("Auditor role is read-only");
  }
  if (role === "org_admin") return;
}

export function assertCanCreateRole(callerRole: Role, targetRole: Role): void {
  if (!canCreateUser(callerRole, targetRole)) {
    throw forbiddenError(
      `Role '${callerRole}' cannot create user with role '${targetRole}'`
    );
  }
}
