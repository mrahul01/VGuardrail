import type { LoginResponse } from "@/types/auth";
import { isLocalAuthDisabled } from "@/lib/auth/local-mode";

export interface CognitoTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export interface CognitoClientConfig {
  readonly domain: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly appUrl: string;
}

export class CognitoClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CognitoClientError";
    this.status = status;
    this.code = code;
  }
}

/** Mock config returned when running in local-dev mode (no Cognito). */
function getMockCognitoConfig(): CognitoClientConfig {
  return {
    domain: "localhost",
    clientId: "mock-client-id",
    clientSecret: undefined,
    redirectUri: "http://localhost:3000/api/auth/callback/cognito",
    appUrl: "http://localhost:3000",
  };
}

export function getCognitoConfig(): CognitoClientConfig {
  if (isLocalAuthDisabled()) {
    return getMockCognitoConfig();
  }

  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri =
    process.env.COGNITO_REDIRECT_URI ?? `${appUrl}/api/auth/callback/cognito`;

  if (!domain || !clientId) {
    throw new CognitoClientError(500, "auth_misconfigured", "Cognito is not configured");
  }

  return {
    domain,
    clientId,
    clientSecret: process.env.COGNITO_CLIENT_SECRET,
    redirectUri,
    appUrl,
  };
}

function authHeaders(config: CognitoClientConfig): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64")}`;
  }
  return headers;
}

async function postTokenRequest(
  config: CognitoClientConfig,
  params: URLSearchParams
): Promise<CognitoTokenResponse> {
  const response = await fetch(`https://${config.domain}/oauth2/token`, {
    method: "POST",
    headers: authHeaders(config),
    body: params.toString(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new CognitoClientError(
      response.status,
      body.error ?? "cognito_error",
      body.error_description ?? "Cognito token request failed"
    );
  }

  return response.json() as Promise<CognitoTokenResponse>;
}

export function getHostedLoginUrl(
  codeChallenge: string,
  state: string,
  redirectPath = "/dashboard"
): string {
  const config = getCognitoConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  params.set("redirect_path", redirectPath);
  return `https://${config.domain}/login?${params.toString()}`;
}

export function getHostedLogoutUrl(): string {
  const config = getCognitoConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: `${config.appUrl}/login`,
  });
  return `https://${config.domain}/logout?${params.toString()}`;
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string
): Promise<CognitoTokenResponse> {
  const config = getCognitoConfig();
  return postTokenRequest(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    })
  );
}

export async function refreshCognitoTokens(
  refreshToken: string
): Promise<CognitoTokenResponse> {
  const config = getCognitoConfig();
  return postTokenRequest(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshToken,
    })
  );
}

export async function revokeCognitoToken(token: string): Promise<void> {
  const config = getCognitoConfig();
  await fetch(`https://${config.domain}/oauth2/revoke`, {
    method: "POST",
    headers: authHeaders(config),
    body: new URLSearchParams({
      token,
      token_type_hint: "refresh_token",
    }).toString(),
  });
}

export function toLoginResponse(tokens: CognitoTokenResponse, user: LoginResponse["user"]): LoginResponse {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    id_token: tokens.id_token,
    expires_in: tokens.expires_in,
    user,
  };
}
