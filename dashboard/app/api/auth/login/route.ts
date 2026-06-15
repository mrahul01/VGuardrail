import { NextRequest, NextResponse } from "next/server";
import { setStoredSession } from "@/lib/auth/session-store";
import {
  isLocalAuthDisabled,
  MOCK_ACCESS_TOKEN,
  MOCK_ID_TOKEN,
  MOCK_REFRESH_TOKEN,
  MOCK_USER_SESSION,
} from "@/lib/auth/local-mode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectPath = req.nextUrl.searchParams.get("redirect") ?? "/dashboard";

  // Local-dev mode: skip Cognito OAuth flow entirely, set mock session.
  if (isLocalAuthDisabled()) {
    await setStoredSession({
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      idToken: MOCK_ID_TOKEN,
      session: MOCK_USER_SESSION,
    });
    return NextResponse.redirect(new URL(redirectPath, req.url));
  }

  // Production: redirect to Cognito Hosted UI.
  const { getHostedLoginUrl } = await import("@/lib/auth/cognito-client");
  const { generateOAuthState, generatePKCE } = await import("@/lib/auth/pkce");

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_APP_URL?.includes("localhost"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10,
  };

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateOAuthState();
  const response = NextResponse.redirect(
    getHostedLoginUrl(codeChallenge, state, redirectPath)
  );
  response.cookies.set("vg_pkce_verifier", codeVerifier, cookieOptions);
  response.cookies.set("vg_oauth_state", state, cookieOptions);
  response.cookies.set("vg_post_login_redirect", redirectPath, cookieOptions);
  return response;
}
