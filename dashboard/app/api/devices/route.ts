import { withRead } from "@/lib/api/with-rbac";
import { badRequest, ok, parsePagination, toPageResponse, toPageQuery } from "@/lib/api/pagination";
import type { ChainStatus, DeviceStatus } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set([
  "hostname",
  "device_id",
  "platform",
  "status",
  "last_seen_ms",
  "event_count_24h",
  "violation_count_24h",
]);

export const GET = withRead(async ({ req, repos }) => {
  const raw = parsePagination(req, {
    allowedSortFields: Array.from(ALLOWED_SORT),
    defaultPerPage: 25,
  });
  const params = req.nextUrl.searchParams;
  const statusRaw = params.get("status");
  const chainRaw = params.get("chain_status");
  const filters: {
    status?: DeviceStatus;
    chainStatus?: ChainStatus;
  } = {};
  if (statusRaw && !["active", "inactive", "deactivated"].includes(statusRaw)) return badRequest("invalid status");
  if (chainRaw && !["verified", "broken", "incomplete", "unknown"].includes(chainRaw)) return badRequest("invalid chain_status");
  if (statusRaw) filters.status = statusRaw as DeviceStatus;
  if (chainRaw) filters.chainStatus = chainRaw as ChainStatus;
  const page = await repos.devices.list(toPageQuery(raw), filters);
  return ok(toPageResponse(page));
});
