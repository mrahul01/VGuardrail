import { withRead } from "@/lib/api/with-rbac";
import { ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ repos }) => {
  const stats = await repos.dashboard.getStats();
  return ok(stats);
});
