import { withRead } from "@/lib/api/with-rbac";
import { notFound, ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const p = await repos.policies.get(params["id"] ?? "");
  if (!p) return notFound();
  return ok(p);
});
