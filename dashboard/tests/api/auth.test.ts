import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CognitoJwtClaims, UserSession } from "@/types/auth";

const cookieJar = new Map<string, string>();
const claims: CognitoJwtClaims = {
  sub: "user-1",
  email: "user@example.com",
  "cognito:groups": ["viewer"],
  "custom:org_id": "org-1",
  "custom:org_name": "Org One",
  "custom:role": "viewer",
  exp: 9999999999,
  iat: 1,
};
const cookieOps = {
  set: vi.fn((name: string, value: string) => {
    cookieJar.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    cookieJar.delete(name);
  }),
  get: vi.fn((name: string) =>
    cookieJar.has(name) ? { value: cookieJar.get(name) as string } : undefined
  ),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieOps),
}));

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("PKCE helpers", () => {
  it("generates RFC-sized verifier and S256 challenge", async () => {
    const { generateCodeChallenge, generateCodeVerifier, generatePKCE } =
      await import("@/lib/auth/pkce");
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(await generateCodeChallenge("abc")).toMatch(/^[A-Za-z0-9_-]+$/);

    const pair = await generatePKCE();
    expect(pair.codeVerifier).toHaveLength(64);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("matches the RFC 7636 PKCE challenge example", async () => {
    const { generateCodeChallenge } = await import("@/lib/auth/pkce");
    await expect(
      generateCodeChallenge(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
      )
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("rejects invalid verifier lengths", async () => {
    const { generateCodeVerifier } = await import("@/lib/auth/pkce");
    expect(() => generateCodeVerifier(10)).toThrow("between 43 and 128");
  });
});

describe("Cognito client", () => {
  it("constructs hosted login and logout URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const { getHostedLoginUrl, getHostedLogoutUrl } = await import(
      "@/lib/auth/cognito-client"
    );

    const login = new URL(getHostedLoginUrl("challenge", "state", "/devices"));
    expect(login.origin).toBe("https://auth.example.com");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("client_id")).toBe("client-123");
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.searchParams.get("state")).toBe("state");

    const logout = new URL(getHostedLogoutUrl());
    expect(logout.pathname).toBe("/logout");
    expect(logout.searchParams.get("logout_uri")).toBe(
      "https://app.example.com/login"
    );
  });
});

describe("JWT claim handling", () => {
  it("extracts role and org_id from verified claims", async () => {
    const { claimsToSession, roleFromClaims } = await import("@/lib/auth/jwt");
    expect(roleFromClaims(claims)).toBe("viewer");
    expect(claimsToSession(claims)).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      role: "viewer",
      orgId: "org-1",
      orgName: "Org One",
    });
  });

  it("falls back to Cognito group for supported role", async () => {
    const { roleFromClaims } = await import("@/lib/auth/jwt");
    expect(
      roleFromClaims({
        ...claims,
        "custom:role": "unsupported",
        "cognito:groups": ["auditor"],
      })
    ).toBe("auditor");
  });

  it("fails closed on unsupported roles and invalid tokens", async () => {
    const { claimsToSession, verifyCognitoJwt } = await import("@/lib/auth/jwt");
    expect(() =>
      claimsToSession({
        ...claims,
        "custom:role": "owner",
        "cognito:groups": [],
      })
    ).toThrow("supported role");

    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    await expect(verifyCognitoJwt("not-a-jwt")).rejects.toThrow(
      "Token verification failed"
    );
  });

  it("passes issuer and audience to JWT verification", async () => {
    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    const jose = await import("jose");
    const { verifyCognitoJwt } = await import("@/lib/auth/jwt");

    vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
      payload: claims,
      protectedHeader: { alg: "RS256" },
    } as never);

    await verifyCognitoJwt("token");
    expect(vi.mocked(jose.jwtVerify)).toHaveBeenCalledWith(
      "token",
      expect.any(Function),
      expect.objectContaining({
        issuer: "https://auth.example.com",
        audience: "client-123",
      })
    );
  });

  it("rejects expired tokens and missing claims", async () => {
    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    const jose = await import("jose");
    const { verifyCognitoJwt } = await import("@/lib/auth/jwt");

    vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new Error("expired"));
    await expect(verifyCognitoJwt("expired-token")).rejects.toThrow(
      "Token verification failed"
    );

    vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
      payload: {
        ...claims,
        email: undefined,
      },
      protectedHeader: { alg: "RS256" },
    } as never);
    await expect(verifyCognitoJwt("missing-email")).rejects.toThrow(
      "Missing email claim"
    );
  });
});

describe("Auth session store", () => {
  const session: UserSession = {
    id: "user-1",
    email: "user@example.com",
    role: "viewer",
    orgId: "org-1",
    orgName: "Org One",
    groups: ["viewer"],
  };

  it("creates secure httpOnly session cookies", async () => {
    const { setStoredSession, ACCESS_TOKEN_COOKIE, SESSION_COOKIE } = await import(
      "@/lib/auth/session-store"
    );

    await setStoredSession({
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "id",
      session,
    });

    expect(cookieOps.set).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      "access",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      })
    );
    expect(cookieOps.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      JSON.stringify(session),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
      })
    );
  });

  it("destroys all auth cookies on logout", async () => {
    const { clearStoredSession, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } =
      await import("@/lib/auth/session-store");

    await clearStoredSession();

    expect(cookieOps.delete).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE);
    expect(cookieOps.delete).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE);
  });

  it("refreshes a stored session and preserves refresh tokens when rotated token is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    cookieJar.set("vg_refresh_token", "refresh");

    const jose = await import("jose");
    const sessionStore = await import("@/lib/auth/session-store");
    const cognitoClient = await import("@/lib/auth/cognito-client");

    vi.spyOn(cognitoClient, "refreshCognitoTokens").mockResolvedValueOnce({
      access_token: "access-2",
      refresh_token: undefined,
      id_token: "id-2",
      expires_in: 3600,
      token_type: "Bearer",
    });
    vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
      payload: claims,
      protectedHeader: { alg: "RS256" },
    } as never);

    const refreshed = await sessionStore.refreshStoredSession();
    expect(refreshed?.accessToken).toBe("access-2");
    expect(refreshed?.refreshToken).toBe("refresh");
  });

  it("fails closed when required tokens are missing", async () => {
    const { getStoredSession } = await import("@/lib/auth/session-store");
    expect(await getStoredSession()).toBeNull();
  });
});

describe("Auth routes", () => {
  it("rejects callback requests with missing or mismatched state", async () => {
    const { GET } = await import("@/app/api/auth/callback/cognito/route");
    const req = new NextRequest(
      "http://localhost/api/auth/callback/cognito?code=abc&state=wrong"
    );

    const response = await GET(req);
    expect(response.headers.get("location")).toContain("/login?error=auth_failed");
  });

  it("builds login redirect cookies for PKCE and state", async () => {
    vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
    const { GET } = await import("@/app/api/auth/login/route");

    const response = await GET(
      new NextRequest("http://localhost/api/auth/login?redirect=/reports")
    );

    expect(response.headers.get("location")).toContain("https://auth.example.com/login");
    expect(response.cookies.get("vg_pkce_verifier")?.value).toBeTruthy();
    expect(response.cookies.get("vg_oauth_state")?.value).toBeTruthy();
    expect(response.cookies.get("vg_post_login_redirect")?.value).toBe("/reports");
  });
});
