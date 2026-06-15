import { withBff } from "@/lib/api/with-rbac";
import { ok, readJson } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export const GET = withBff({}, async ({ repos }) => {
  const settings = await repos.org.get();
  return ok(settings);
});

interface OrgUpdateBody {
  readonly org_name?: string;
  readonly default_policy_id?: string;
  readonly enrollment_mode?: "open" | "invite" | "closed";
  readonly data_retention_days?: number;
  readonly email_alerts?: boolean;
  readonly slack_webhook_url?: string | null;
}

const PATCH_KEYS = [
  "org_name",
  "default_policy_id",
  "enrollment_mode",
  "data_retention_days",
  "email_alerts",
  "slack_webhook_url",
] as const;

export const PATCH = withBff({}, async ({ req, repos }) => {
  const body = (await readJson<OrgUpdateBody>(req)) ?? {};
  const patch: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (key in body) patch[key] = body[key];
  }
  const next = await repos.org.update(patch);
  return ok(next);
});
