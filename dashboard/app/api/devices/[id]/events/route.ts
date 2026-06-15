import { withRead } from "@/lib/api/with-rbac";
import { ok, parsePagination, toPageQuery, toPageResponse } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ req, params, repos }) => {
  const raw = parsePagination(req, { defaultPerPage: 25 });
  const page = await repos.devices.events(params["id"] ?? "", toPageQuery(raw));
  return ok(toPageResponse(page));
});
