import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { CognitoJwtClaims, Role, UserSession } from "@/types/auth";
import {
  isLocalAuthDisabled,
  MOCK_USER_SESSION,
} from "@/lib/auth/local-mode";

const ROLES: readonly Role[] = ["super_admin", "org_admin", "auditor", "viewer"];

export class AuthError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface CognitoJwtConfig {
  readonly issuer: string;
  readonly clientId: string;
}

function getJwtConfig(): CognitoJwtConfig {
  const issuer =
    process.env.COGNITO_ISSUER ??
    process.env.NEXT_PUBLIC_COGNITO_ISSUER ??
    (process.env.NEXT_PUBLIC_COGNITO_DOMAIN
      ? `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}`
      : "");
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";

  if (!issuer || !clientId) {
    throw new AuthError("auth_misconfigured", "Cognito issuer or client id is missing");
  }

  return { issuer, clientId };
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  jwksByIssuer.set(issuer, jwks);
  return jwks;
}

function stringClaim(payload: JWTPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError("invalid_token", `Missing ${key} claim`);
  }
  return value;
}

function groupsClaim(payload: JWTPayload): string[] {
  const value = payload["cognito:groups"];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function roleFromClaims(claims: Pick<CognitoJwtClaims, "custom:role" | "cognito:groups">): Role {
  const claimRole = claims["custom:role"];
  if (ROLES.includes(claimRole as Role)) return claimRole as Role;

  const groupRole = ROLES.find((role) => claims["cognito:groups"].includes(role));
  if (groupRole) return groupRole;

  throw new AuthError("invalid_role", "Token does not contain a supported role");
}

export function claimsToSession(claims: CognitoJwtClaims): UserSession {
  const role = roleFromClaims(claims);
  const orgId = claims["custom:org_id"];
  if (!orgId) {
    throw new AuthError("invalid_org", "Token does not contain an org_id claim");
  }

  return {
    id: claims.sub,
    email: claims.email,
    role,
    orgId,
    orgName: claims["custom:org_name"] ?? orgId,
    groups: claims["cognito:groups"],
  };
}

export async function verifyCognitoJwt(token: string): Promise<CognitoJwtClaims> {
  // Local-dev mode: skip Cognito verification entirely.
  if (isLocalAuthDisabled()) {
    const now = Math.floor(Date.now() / 1000);
    return {
      sub: MOCK_USER_SESSION.id,
      email: MOCK_USER_SESSION.email,
      "cognito:groups": MOCK_USER_SESSION.groups,
      "custom:org_id": MOCK_USER_SESSION.orgId,
      "custom:org_name": MOCK_USER_SESSION.orgName,
      "custom:role": MOCK_USER_SESSION.role,
      exp: now + 60 * 60 * 24 * 30,
      iat: now,
    };
  }

  try {
    const { issuer, clientId } = getJwtConfig();
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience: clientId,
    });

    return {
      sub: stringClaim(payload, "sub"),
      email: stringClaim(payload, "email"),
      "cognito:groups": groupsClaim(payload),
      "custom:org_id": stringClaim(payload, "custom:org_id"),
      "custom:org_name":
        typeof payload["custom:org_name"] === "string"
          ? payload["custom:org_name"]
          : undefined,
      // Optional: the pool derives role from `cognito:groups` (see roleFromClaims).
      // Only a handful of pools set an explicit `custom:role` attribute, so this
      // must NOT be hard-required or every group-based login fails with auth_failed.
      "custom:role":
        typeof payload["custom:role"] === "string" && payload["custom:role"].length > 0
          ? payload["custom:role"]
          : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : 0,
      iat: typeof payload.iat === "number" ? payload.iat : 0,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("invalid_token", "Token verification failed");
  }
}

export async function verifySessionToken(token: string): Promise<UserSession> {
  // Local-dev mode: skip verification and return mock session.
  if (isLocalAuthDisabled()) {
    return { ...MOCK_USER_SESSION };
  }
  return claimsToSession(await verifyCognitoJwt(token));
}
