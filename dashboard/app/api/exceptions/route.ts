import { withAction, withRead } from "@/lib/api/with-rbac";
import {
  badRequest,
  created,
  ok,
  parsePagination,
  readJson,
  toPageQuery,
  toPageResponse,
} from "@/lib/api/pagination";
import type { ExceptionStatus } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set([
  "exception_id",
  "status",
  "requested_by",
  "expires_at_ms",
]);

export const GET = withRead(async ({ req, repos }) => {
  const raw = parsePagination(req, {
    allowedSortFields: Array.from(ALLOWED_SORT),
    defaultPerPage: 25,
  });
  const params = req.nextUrl.searchParams;
  const filters: {
    status?: ExceptionStatus;
    requestedBy?: string;
  } = {};
  const status = params.get("status");
  const requestedBy = params.get("requested_by");
  if (status && !["pending", "approved", "rejected", "expired", "revoked"].includes(status)) return badRequest("invalid status");
  if (status) filters.status = status as ExceptionStatus;
  if (requestedBy) filters.requestedBy = requestedBy;
  const page = await repos.exceptions.list(toPageQuery(raw), filters);
  return ok(toPageResponse(page));
});

interface CreateBody {
  readonly rule_id?: string;
  readonly reason?: string;
}

export const POST = withAction("create:exception", async ({ req, repos }) => {
  const body = (await readJson<CreateBody>(req)) ?? {};
  const ruleId = body.rule_id?.trim();
  const reason = body.reason?.trim();
  if (!ruleId) return badRequest("rule_id is required");
  if (!reason) return badRequest("reason is required");
  const exception = await repos.exceptions.create(ruleId, reason);
  return created(exception);
});
