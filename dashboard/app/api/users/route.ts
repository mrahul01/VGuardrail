import { withBff } from "@/lib/api/with-rbac";
import {
  badRequest,
  created,
  ok,
  parsePagination,
  readJson,
  toPageQuery,
  toPageResponse,
} from "@/lib/api/pagination";
import { assertCanCreateRole } from "@/lib/auth/rbac-middleware";
import type { Role } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES: ReadonlySet<Role> = new Set([
  "super_admin",
  "org_admin",
  "auditor",
  "viewer",
]);

const isRole = (value: string): value is Role =>
  ALLOWED_ROLES.has(value as Role);

export const GET = withBff({}, async ({ req, repos }) => {
  const raw = parsePagination(req, { defaultPerPage: 25 });
  const page = await repos.users.list(toPageQuery(raw));
  return ok(toPageResponse(page));
});

interface InviteBody {
  readonly email?: string;
  readonly role?: string;
}

export const POST = withBff({}, async ({ req, repos }) => {
  const body = (await readJson<InviteBody>(req)) ?? {};
  const email = body.email?.trim();
  const role = body.role?.trim();
  if (!email) return badRequest("email is required");
  if (!role || !isRole(role)) return badRequest("role is required");
  assertCanCreateRole(repos.session.role, role);
  const user = await repos.users.invite(email, role);
  return created(user);
});
