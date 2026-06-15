import type { Role } from "@/types";

/**
 * Role hierarchy:
 * super_admin → org_admin → auditor → viewer
 * Higher roles inherit permissions from lower roles.
 */

const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 100,
  org_admin: 80,
  auditor: 50,
  viewer: 20,
};

/** Allowed target roles when creating a user. */
const ALLOWED_CREATION_TARGETS: Record<Role, Role[]> = {
  super_admin: ["super_admin", "org_admin", "auditor", "viewer"],
  org_admin: ["auditor", "viewer"],
  auditor: [],
  viewer: [],
};

/** Page-level access control. */
const PAGE_ACCESS: Record<string, Role[]> = {
  "/dashboard": ["super_admin", "org_admin", "auditor", "viewer"],
  "/devices": ["super_admin", "org_admin", "auditor", "viewer"],
  "/devices/[id]": ["super_admin", "org_admin", "auditor", "viewer"],
  "/policies": ["super_admin", "org_admin", "auditor"],
  "/policies/[id]": ["super_admin", "org_admin", "auditor"],
  "/policies/new": ["super_admin", "org_admin"],
  "/violations": ["super_admin", "org_admin", "auditor", "viewer"],
  "/exceptions": ["super_admin", "org_admin", "auditor"],
  "/exceptions/[id]": ["super_admin", "org_admin", "auditor"],
  "/exceptions/new": ["super_admin", "org_admin"],
  "/audit": ["super_admin", "org_admin", "auditor"],
  "/audit/[event_id]": ["super_admin", "org_admin", "auditor"],
  "/settings": ["super_admin", "org_admin"],
  "/settings/users": ["super_admin", "org_admin"],
  "/settings/enrollment": ["super_admin", "org_admin"],
};

/** Check if a role can view a given page path. */
export function canViewPage(role: Role, path: string): boolean {
  const allowed = PAGE_ACCESS[path];
  if (!allowed) return false;
  return allowed.includes(role);
}

/** Check if a role can perform a given action on a resource. */
export function canPerformAction(role: Role, action: string): boolean {
  switch (action) {
    case "create:policy":
    case "update:policy":
    case "delete:policy":
    case "publish:policy":
    case "create:exception":
    case "approve:exception":
    case "deactivate:device":
    case "manage:settings":
    case "manage:enrollment":
      return role === "super_admin" || role === "org_admin";
    case "create:super_admin":
      return role === "super_admin";
    case "view:audit":
    case "export:audit":
      return role === "super_admin" || role === "org_admin" || role === "auditor";
    case "view:violations":
      return true;
    default:
      return false;
  }
}

/** Check if a caller can create a user with the target role (REMEDIATED E-01). */
export function canCreateUser(callerRole: Role, targetRole: Role): boolean {
  return ALLOWED_CREATION_TARGETS[callerRole]?.includes(targetRole) ?? false;
}

/** Get the numerical hierarchy level for a role. */
export function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

/** Check if caller role is at least the required role. */
export function isAtLeast(callerRole: Role, requiredRole: Role): boolean {
  return getRoleLevel(callerRole) >= getRoleLevel(requiredRole);
}

/** Get sidebar menu items based on role. */
export function getSidebarItems(role: Role): Array<{ label: string; href: string; icon: string }> {
  const items: Array<{ label: string; href: string; icon: string }> = [
    { label: "Dashboard", href: "/dashboard", icon: "◇" },
    { label: "Devices", href: "/devices", icon: "◇" },
  ];

  if (role !== "viewer") {
    items.push({ label: "Policies", href: "/policies", icon: "◇" });
  }

  items.push({ label: "Violations", href: "/violations", icon: "◇" });

  if (role !== "viewer") {
    items.push({ label: "Exceptions", href: "/exceptions", icon: "◇" });
  }

  if (role === "super_admin" || role === "org_admin" || role === "auditor") {
    items.push({ label: "Audit", href: "/audit", icon: "◇" });
  }

  if (role === "super_admin" || role === "org_admin") {
    items.push({ label: "Settings", href: "/settings", icon: "◇" });
  }

  return items;
}