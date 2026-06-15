import { NextResponse } from "next/server";
import { logoutStoredSession } from "@/lib/auth/session-store";
import { isLocalAuthDisabled } from "@/lib/auth/local-mode";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  await logoutStoredSession();
  return NextResponse.json({ ok: true });
}

export async function GET(): Promise<NextResponse> {
  await logoutStoredSession();
  // Local-dev mode: redirect to login page (no Cognito logout needed).
  if (isLocalAuthDisabled()) {
    return NextResponse.redirect(new URL("/login", "http://localhost:3000"));
  }
  const { getHostedLogoutUrl } = await import("@/lib/auth/cognito-client");
  return NextResponse.redirect(getHostedLogoutUrl());
}
