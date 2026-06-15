/**
 * Dashboard middleware — post-migration (Phase 5).
 *
 * Before Phase 5, this middleware verified the user's Cognito JWT
 * locally using `jose` with a *shared HS256 secret*. That was a
 * security defect: HS256 with a static secret is symmetric-key
 * crypto, not Cognito's RS256. The dashboard also used the secret
 * to mint request headers (`x-user-*`) for its BFF.
 *
 * After Phase 5, real JWT verification is the **backend's**
 * responsibility (see `backend/server/src/auth.rs`). The dashboard
 * middleware has been reduced to a thin pass-through whose only
 * remaining jobs are:
 *
 *   1. Refresh the cookie session if the access token is about to
 *      expire (the user's tokens were minted by the backend via
 *      Cognito's OAuth code flow).
 *   2. Forward the caller's `Authorization: Bearer <jwt>` to the
 *      BFF, which forwards it to the backend verbatim.
 *   3. Redirect unauthenticated users to `/login`.
 *
 * Public paths (login, refresh, static assets) skip the check
 * entirely.
 *
 * Notes:
 *   * The legacy HS256 `COGNITO_JWT_SECRET` env var is **ignored**.
 *   * The dashboard no longer computes `x-user-*` headers; the BFF
 *     re-reads them from the session cookie via
 *     `lib/api/request-context.ts`.
 *   * If the operator wants defense-in-depth RS256 verification on
 *     the dashboard too, the backend's `JwksCache` is reusable.
 *     For now we rely on the backend to enforce auth.
 */


import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/_next",
  "/favicon.ico",
  "/public",
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

function isAuthDisabled(): boolean {
  return process.env.DISABLE_AUTH === "true";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // When DISABLE_AUTH is set, skip all authentication checks entirely.
  if (isAuthDisabled()) {
    return NextResponse.next();
  }

  // Public paths — no checks, no forwarding.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get("vg_access_token")?.value;

  if (!accessToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Forward the access token to BFF routes; pass through for page
  // navigations. The backend (or BFF, depending on the route) is
  // the authoritative verifier.
  const requestHeaders = new Headers(request.headers);
  if (pathname.startsWith("/api/")) {
    requestHeaders.set("authorization", `Bearer ${accessToken}`);
  }

  // Lightweight client-side expiration hint. The BFF / backend is
  // the actual source of truth and will return 401 if the token is
  // rejected; we just try a refresh first to give a smoother UX.
  const exp = parseJwtExp(accessToken);
  if (exp !== null && exp - Math.floor(Date.now() / 1000) < 60) {
    const refreshToken = request.cookies.get("vg_refresh_token")?.value;
    if (refreshToken) {
      const refreshUrl = new URL("/api/auth/refresh", request.url);
      refreshUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(refreshUrl);
    }
    // No refresh token — clear cookies and bounce to login.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("vg_access_token");
    response.cookies.delete("vg_refresh_token");
    return response;
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Returns the JWT `exp` claim (Unix seconds), or `null` if the token
 * cannot be decoded. **No signature verification** — the backend
 * does that. This is a UI-side hint only.
 */
function parseJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // `atob` is available in the Edge runtime used by middleware.
    const payload = JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public assets)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
