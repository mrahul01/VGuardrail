import { withRead } from "@/lib/api/with-rbac";
import { badRequest, ok, parsePagination, toPageQuery, toPageResponse } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set([
  "event_id",
  "timestamp_ms",
  "type",
  "decision",
  "risk_level",
]);

export const GET = withRead(async ({ req, repos }) => {
  const raw = parsePagination(req, {
    allowedSortFields: Array.from(ALLOWED_SORT),
    defaultPerPage: 25,
  });
  const params = req.nextUrl.searchParams;
  const filters: {
    type?: string;
    from?: string;
    to?: string;
  } = {};
  const type = params.get("type");
  const from = params.get("from");
  const to = params.get("to");
  if (from && Number.isNaN(new Date(from).getTime())) return badRequest("invalid from date");
  if (to && Number.isNaN(new Date(to).getTime())) return badRequest("invalid to date");
  if (from && to) {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (toMs < fromMs) return badRequest("to must be after from");
    if (toMs - fromMs > 90 * 24 * 60 * 60 * 1000) {
      return badRequest("audit date range cannot exceed 90 days");
    }
  }
  if (type) filters.type = type;
  if (from) filters.from = from;
  if (to) filters.to = to;
  const page = await repos.audit.list(toPageQuery(raw), filters);
  return ok(toPageResponse(page));
});
