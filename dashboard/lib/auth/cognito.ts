import { SignJWT, jwtVerify } from "jose";
import type { CognitoJwtClaims, LoginResponse, UserSession } from "@/types/auth";

const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/cognito`;
const JWT_SECRET = new TextEncoder().encode(process.env.COGNITO_JWT_SECRET || "dev-secret-change-in-production");

/** Exchange authorization code for tokens via PKCE */
export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<LoginResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
  }

  return response.json();
}

/** Refresh access token using refresh token */
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; id_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
  }

  return response.json();
}

/** Revoke tokens (logout) */
export async function revokeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    fetch(`https://${COGNITO_DOMAIN}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }).toString(),
    }),
    fetch(`https://${COGNITO_DOMAIN}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }).toString(),
    }),
  ]);
}

/** Get Cognito JWKS for token verification */
export async function getJwks(): Promise<{ keys: any[] }> {
  const response = await fetch(`https://${COGNITO_DOMAIN}/.well-known/jwks.json`);
  return response.json();
}

/** Verify and decode JWT using Cognito JWKS */
export async function verifyCognitoToken(token: string): Promise<CognitoJwtClaims> {
  const { payload } = await jwtVerify(token, JWT_SECRET, {
    issuer: `https://${COGNITO_DOMAIN}`,
    audience: CLIENT_ID,
  });
  return payload as unknown as CognitoJwtClaims;
}

/** Create session JWT for frontend (short-lived, 15 min per E-03 remediation) */
export async function createSessionToken(claims: CognitoJwtClaims): Promise<string> {
  return new SignJWT({
    sub: claims.sub,
    email: claims.email,
    "cognito:groups": claims["cognito:groups"],
    "custom:org_id": claims["custom:org_id"],
    "custom:role": claims["custom:role"],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m") // 15 minutes - remediation E-03
    .sign(JWT_SECRET);
}

/** Convert Cognito claims to UserSession */
export function claimsToSession(claims: CognitoJwtClaims): UserSession {
  const groups = claims["cognito:groups"] || [];
  const role = (claims["custom:role"] as "super_admin" | "org_admin" | "auditor" | "viewer") || "viewer";
  
  return {
    id: claims.sub,
    email: claims.email,
    role,
    orgId: claims["custom:org_id"],
    orgName: "", // Would be fetched from org metadata
    groups,
  };
}

/** Generate PKCE code verifier and challenge */
export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    const byte = randomValues[i];
    if (byte !== undefined) {
      const index = byte % chars.length;
      result += chars.charAt(index);
    }
  }
  return result;
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Get Cognito Hosted UI login URL */
export function getLoginUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `https://${COGNITO_DOMAIN}/login?${params.toString()}`;
}

/** Get Cognito Hosted UI logout URL */
export function getLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
  });
  return `https://${COGNITO_DOMAIN}/logout?${params.toString()}`;
}