/**
 * Root route — `/`.
 *
 * The dashboard's primary surface is `/dashboard`, but operators
 * hit `http://localhost:3000/` (or the production origin) first.
 * Without this file, the App Router falls through to the default
 * `_not-found` page, which is the 404 users see in the browser.
 *
 * This component is a **server component** that inspects the
 * `vg_access_token` / `vg_id_token` cookies via the existing
 * `session-store` helper and:
 *
 *   * Redirects to `/dashboard` when a valid stored session is found.
 *   * Redirects to `/login?redirect=%2F` when there is no session
 *     (or the stored JWT failed verification, in which case
 *     `getStoredSession` has already cleared the cookies).
 *
 * `force-dynamic` ensures the redirect decision is re-evaluated
 * on every request — no static caching of an auth-aware redirect.
 */

import { redirect } from "next/navigation";
import { getStoredSession } from "@/lib/auth/session-store";
import { isLocalAuthDisabled } from "@/lib/auth/local-mode";

export const dynamic = "force-dynamic";

export default async function RootPage(): Promise<never> {
  // Local-dev mode: always redirect to /dashboard (no login screen).
  if (isLocalAuthDisabled()) {
    redirect("/dashboard");
  }

  const stored = await getStoredSession();

  if (stored) {
    redirect("/dashboard");
  }

  redirect("/login?redirect=%2F");
}
