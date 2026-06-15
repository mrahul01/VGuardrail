import { NextResponse } from "next/server";
import { getOrRefreshStoredSession } from "@/lib/auth/session-store";
import { isLocalAuthDisabled, MOCK_USER_SESSION } from "@/lib/auth/local-mode";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // Local-dev mode: always return mock session.
  if (isLocalAuthDisabled()) {
    return NextResponse.json({
      user: MOCK_USER_SESSION,
      expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000).toISOString(),
    });
  }

  const stored = await getOrRefreshStoredSession();
  if (!stored) {
    return NextResponse.json({});
  }
  return NextResponse.json({
    user: stored.session,
    expires: expiryFromJwt(stored.accessToken),
  });
}

/** Read the JWT `exp` (Unix seconds) and return it as an ISO string. */
function expiryFromJwt(token: string): string {
  try {
    const part = token.split(".")[1] ?? "";
    const json = Buffer.from(part, "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    if (typeof exp === "number") {
      return new Date(exp * 1000).toISOString();
    }
  } catch {
    /* fall through to a short default */
  }
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}
