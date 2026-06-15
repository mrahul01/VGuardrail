import type { NextRequest } from "next/server";

/**
 * Resolve the public base URL for building auth redirects.
 *
 * The Next.js standalone server binds `HOSTNAME=0.0.0.0`, so a route handler's
 * `req.url` reports `http://0.0.0.0:3000`. Redirecting there breaks the cookie
 * origin (0.0.0.0 is not a secure context and is a different origin from
 * localhost), which loops the OAuth login with `auth_failed`.
 *
 * Resolution order:
 *   1. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by ngrok / ALB / Caddy.
 *   2. The request `Host` header, unless it is the 0.0.0.0 bind address.
 *   3. `NEXT_PUBLIC_APP_URL` — the configured public origin.
 *   4. The request origin (last resort).
 *
 * This makes the flow correct on plain `localhost`, behind a tunnel, and in
 * production without per-route changes.
 */
export function appBaseUrl(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const first = fwdHost.split(",")[0] ?? fwdHost;
    return `${proto}://${first.trim()}`;
  }
  const host = req.headers.get("host");
  if (host && !host.startsWith("0.0.0.0")) {
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return req.nextUrl.origin;
}
