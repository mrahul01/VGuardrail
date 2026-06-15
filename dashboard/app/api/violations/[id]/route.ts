import { withRead } from "@/lib/api/with-rbac";
import { notFound, ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const v = await repos.violations.get(params["id"] ?? "");
  if (!v) return notFound();
  if (repos.session.role === "viewer") {
    return ok({ ...v, matched_rule_id: null, matched_rule: null });
  }
  return ok(v);
});
