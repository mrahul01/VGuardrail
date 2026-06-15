import { withAction, withRead } from "@/lib/api/with-rbac";
import { notFound, ok } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withRead(async ({ params, repos }) => {
  const d = await repos.devices.get(params["id"] ?? "");
  if (!d) return notFound();
  return ok(d);
});

export const DELETE = withAction("deactivate:device", async ({ params, repos }) => {
  const d = await repos.devices.get(params["id"] ?? "");
  if (!d) return notFound();
  await repos.devices.deactivate(d.device_id);
  return ok({ deactivated: true, device_id: d.device_id });
});
