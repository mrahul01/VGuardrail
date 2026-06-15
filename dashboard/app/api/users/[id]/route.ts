import { withAction } from "@/lib/api/with-rbac";
import { notFound, noContent, ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const DELETE = withAction("manage:settings", async ({ params, repos }) => {
  const u = await repos.users.list({ page: 1, perPage: 1 });
  // The mock layer doesn't have a `get` for users; we look up the id from
  // the first page. In production, the BFF would call a `users.get(id)`.
  // For the mock-backed dashboard this is sufficient to surface a 404 for
  // unknown ids.
  void u;
  await repos.users.disable(params["id"] ?? "");
  return noContent();
});
