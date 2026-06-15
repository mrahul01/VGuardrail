import { withAction, withRead } from "@/lib/api/with-rbac";
import {
  badRequest,
  notFound,
  ok,
  readJson,
} from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const e = await repos.exceptions.get(params["id"] ?? "");
  if (!e) return notFound();
  return ok(e);
});

interface ApproveBody {
  readonly action?: "approve" | "reject";
  readonly reason?: string;
}

export const POST = withAction("approve:exception", async ({ req, params, repos }) => {
  const e = await repos.exceptions.get(params["id"] ?? "");
  if (!e) return notFound();
  const body = (await readJson<ApproveBody>(req)) ?? {};
  const action = body.action ?? "approve";
  const approver = repos.session.email;
  if (action === "reject") {
    if (!body.reason || body.reason.trim().length === 0) {
      return badRequest("reason is required for rejection");
    }
    const updated = await repos.exceptions.reject(
      e.exception_id,
      approver,
      body.reason
    );
    return ok(updated);
  }
  const updated = await repos.exceptions.approve(e.exception_id, approver);
  return ok(updated);
});
