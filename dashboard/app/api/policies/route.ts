import { withRead } from "@/lib/api/with-rbac";
import { badRequest, ok, parsePagination, toPageQuery, toPageResponse } from "@/lib/api/pagination";
import type { PolicyStatus } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set([
  "name",
  "version",
  "status",
  "rule_count",
  "created_at",
  "published_at",
]);

export const GET = withRead(async ({ req, repos }) => {
  const raw = parsePagination(req, {
    allowedSortFields: Array.from(ALLOWED_SORT),
    defaultPerPage: 25,
  });
  const params = req.nextUrl.searchParams;
  const statusRaw = params.get("status");
  const filters: { status?: PolicyStatus } = {};
  if (statusRaw && !["draft", "active", "superseded", "rollback"].includes(statusRaw)) return badRequest("invalid status");
  if (statusRaw) filters.status = statusRaw as PolicyStatus;
  const page = await repos.policies.list(toPageQuery(raw), filters);
  return ok(toPageResponse(page));
});
