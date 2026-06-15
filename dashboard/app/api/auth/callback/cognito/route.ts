import { NextRequest, NextResponse } from "next/server";
import { setStoredSession } from "@/lib/auth/session-store";
import {
  isLocalAuthDisabled,
  MOCK_ACCESS_TOKEN,
  MOCK_ID_TOKEN,
  MOCK_REFRESH_TOKEN,
  MOCK_USER_SESSION,
} from "@/lib/auth/local-mode";
import { exchangeAuthorizationCode } from "@/lib/auth/cognito-client";
import { claimsToSession, verifyCognitoJwt, AuthError } from "@/lib/auth/jwt";
import { appBaseUrl } from "@/lib/auth/app-url";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectPath = req.cookies.get("vg_post_login_redirect")?.value ?? "/dashboard";

  // Local-dev mode: skip Cognito token exchange, set mock session.
  if (isLocalAuthDisabled()) {
    await setStoredSession({
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      idToken: MOCK_ID_TOKEN,
      session: MOCK_USER_SESSION,
    });
    const base = appBaseUrl(req);
    // Clean up OAuth flow cookies.
    const response = NextResponse.redirect(new URL(redirectPath, base));
    response.cookies.delete("vg_pkce_verifier");
    response.cookies.delete("vg_oauth_state");
    response.cookies.delete("vg_post_login_redirect");
    return response;
  }

  // ── Production Cognito OAuth code-flow ──────────────────────────────
  // Base all redirects on the real public origin, NOT req.url — the standalone
  // server's req.url host is 0.0.0.0, which would break the cookie origin.
  const base = appBaseUrl(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const verifier = req.cookies.get("vg_pkce_verifier")?.value;
  const expectedState = req.cookies.get("vg_oauth_state")?.value;

  console.error("CALLBACK_PARAMS", {
    code: code ? `${code.substring(0, 8)}...` : "MISSING",
    state: state ? `${state.substring(0, 8)}...` : "MISSING",
    verifier: verifier ? `${verifier.substring(0, 8)}...` : "MISSING",
    expectedState: expectedState ? `${expectedState.substring(0, 8)}...` : "MISSING",
    stateMatch: state === expectedState,
    redirectPath,
  });

  if (!code || !state || !verifier || state !== expectedState) {
    console.error("CALLBACK_FAILED_STATE_CHECK", {
      codePresent: !!code,
      statePresent: !!state,
      verifierPresent: !!verifier,
      statesEqual: state === expectedState,
    });
    return NextResponse.redirect(new URL("/login?error=auth_failed", base));
  }

  try {
    console.error("TOKEN_EXCHANGE_START");
    const tokens = await exchangeAuthorizationCode(code, verifier);
    console.error("TOKEN_EXCHANGE_SUCCESS", {
      accessToken: tokens.access_token ? `${tokens.access_token.substring(0, 8)}...` : "MISSING",
      idToken: tokens.id_token ? `${tokens.id_token.substring(0, 8)}...` : "MISSING",
      refreshToken: tokens.refresh_token ? `${tokens.refresh_token.substring(0, 8)}...` : "NOT_PROVIDED",
      expiresIn: tokens.expires_in,
    });

    console.error("JWT_VERIFY_START");
    const claims = await verifyCognitoJwt(tokens.id_token);
    console.error("JWT_VERIFY_SUCCESS", {
      sub: claims.sub,
      email: claims.email,
      groups: claims["cognito:groups"],
      orgId: claims["custom:org_id"],
      orgName: claims["custom:org_name"],
      role: claims["custom:role"],
    });

    console.error("CLAIMS_TO_SESSION_START");
    const session = claimsToSession(claims);
    console.error("CLAIMS_TO_SESSION_SUCCESS", {
      id: session.id,
      email: session.email,
      role: session.role,
      orgId: session.orgId,
      groups: session.groups,
    });

    const response = NextResponse.redirect(new URL(redirectPath, base));
    response.cookies.delete("vg_pkce_verifier");
    response.cookies.delete("vg_oauth_state");
    response.cookies.delete("vg_post_login_redirect");

    console.error("SET_SESSION_START");
    await setStoredSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      session,
    });
    console.error("SET_SESSION_SUCCESS");

    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      console.error("AUTH_ERROR", {
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
    } else if (err instanceof Error) {
      console.error("CALLBACK_ERROR", {
        name: err.name,
        message: err.message,
        stack: err.stack,
      });
    } else {
      console.error("CALLBACK_UNKNOWN_ERROR", String(err));
    }
    return NextResponse.redirect(new URL("/login?error=auth_failed", base));
  }
}