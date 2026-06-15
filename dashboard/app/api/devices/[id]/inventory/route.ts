import { withRead } from "@/lib/api/with-rbac";
import { ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const inv = await repos.devices.inventory(params["id"] ?? "");
  return ok(inv);
});
