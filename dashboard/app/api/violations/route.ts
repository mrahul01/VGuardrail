import { withRead } from "@/lib/api/with-rbac";
import { badRequest, ok, parsePagination, toPageQuery, toPageResponse } from "@/lib/api/pagination";
import type { Page } from "@/lib/api/types";
import type { Decision, Severity, Source } from "@/types";
import { CATEGORIES } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set([
  "event_id",
  "timestamp_ms",
  "decision",
  "risk_level",
  "policy_version",
  "classification",
]);

export const GET = withRead(async ({ req, repos }) => {
  const raw = parsePagination(req, {
    allowedSortFields: Array.from(ALLOWED_SORT),
    defaultPerPage: 25,
  });
  const params = req.nextUrl.searchParams;
  const filters: {
    severity?: Severity;
    decision?: Decision;
    source?: Source;
    category?: string;
    from?: string;
    to?: string;
  } = {};
  const sev = params.get("severity");
  const dec = params.get("decision");
  const src = params.get("source");
  const cat = params.get("category");
  const from = params.get("from");
  const to = params.get("to");
  if (sev && !["low", "medium", "high", "critical"].includes(sev)) return badRequest("invalid severity");
  if (dec && !["allow", "warn", "block"].includes(dec)) return badRequest("invalid decision");
  if (src && !["browser", "ide", "cli", "api"].includes(src)) return badRequest("invalid source");
  if (cat && !CATEGORIES.some((c) => c.value === cat)) return badRequest("invalid category");
  if (sev) filters.severity = sev as Severity;
  if (dec) filters.decision = dec as Decision;
  if (src) filters.source = src as Source;
  if (cat) filters.category = cat;
  if (from) filters.from = from;
  if (to) filters.to = to;
  const page = await repos.violations.list(toPageQuery(raw), filters);
  if (repos.session.role === "viewer") {
    const safePage: Page<(typeof page.items)[number]> = {
      ...page,
      items: page.items.map((item) => ({ ...item, matched_rule_id: null })),
    };
    return ok(toPageResponse(safePage));
  }
  return ok(toPageResponse(page));
});
