import { withRead } from "@/lib/api/with-rbac";
import { notFound, ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const e = await repos.audit.get(params["id"] ?? "");
  if (!e) return notFound();
  return ok(e);
});
