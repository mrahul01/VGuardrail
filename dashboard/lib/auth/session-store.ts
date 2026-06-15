import { cookies } from "next/headers";
import type { UserSession } from "@/types/auth";
import { verifySessionToken } from "@/lib/auth/jwt";
import { refreshCognitoTokens, revokeCognitoToken } from "@/lib/auth/cognito-client";
import {
  isLocalAuthDisabled,
  MOCK_ACCESS_TOKEN,
  MOCK_ID_TOKEN,
  MOCK_REFRESH_TOKEN,
  MOCK_USER_SESSION,
  MOCK_MAX_AGE_SECONDS,
} from "@/lib/auth/local-mode";

export const ACCESS_TOKEN_COOKIE = "vg_access_token";
export const REFRESH_TOKEN_COOKIE = "vg_refresh_token";
export const ID_TOKEN_COOKIE = "vg_id_token";
export const SESSION_COOKIE = "vg_session";

const ACCESS_MAX_AGE_SECONDS = 60 * 15;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const baseCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_APP_URL?.includes("localhost"),
  sameSite: "lax" as const,
  path: "/",
};

export interface StoredAuthSession {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string;
  readonly session: UserSession;
}

export async function setStoredSession(input: {
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  readonly idToken: string;
  readonly session: UserSession;
}): Promise<void> {
  if (isLocalAuthDisabled()) {
    // In local-dev mode, always set mock cookies regardless of input.
    const cookieStore = await cookies();
    cookieStore.set(ACCESS_TOKEN_COOKIE, MOCK_ACCESS_TOKEN, {
      ...baseCookie,
      maxAge: MOCK_MAX_AGE_SECONDS,
    });
    cookieStore.set(ID_TOKEN_COOKIE, MOCK_ID_TOKEN, {
      ...baseCookie,
      maxAge: MOCK_MAX_AGE_SECONDS,
    });
    cookieStore.set(SESSION_COOKIE, JSON.stringify(MOCK_USER_SESSION), {
      ...baseCookie,
      maxAge: MOCK_MAX_AGE_SECONDS,
    });
    return;
  }
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, input.accessToken, {
    ...baseCookie,
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  cookieStore.set(ID_TOKEN_COOKIE, input.idToken, {
    ...baseCookie,
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  cookieStore.set(SESSION_COOKIE, JSON.stringify(input.session), {
    ...baseCookie,
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });

  if (input.refreshToken) {
    cookieStore.set(REFRESH_TOKEN_COOKIE, input.refreshToken, {
      ...baseCookie,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    });
  }
}

export async function clearStoredSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
  cookieStore.delete(ID_TOKEN_COOKIE);
  cookieStore.delete(SESSION_COOKIE);
}

export async function getStoredSession(): Promise<StoredAuthSession | null> {
  // Local-dev mode: always return mock session without cookie checks.
  if (isLocalAuthDisabled()) {
    return {
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      idToken: MOCK_ID_TOKEN,
      session: { ...MOCK_USER_SESSION },
    };
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const idToken = cookieStore.get(ID_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value ?? null;

  if (!accessToken || !idToken) return null;

  try {
    return {
      accessToken,
      refreshToken,
      idToken,
      session: await verifySessionToken(idToken),
    };
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function refreshStoredSession(): Promise<StoredAuthSession | null> {
  // Local-dev mode: return mock session (tokens never expire locally).
  if (isLocalAuthDisabled()) {
    return {
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      idToken: MOCK_ID_TOKEN,
      session: { ...MOCK_USER_SESSION },
    };
  }

  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    await clearStoredSession();
    return null;
  }

  try {
    const tokens = await refreshCognitoTokens(refreshToken);
    const session = await verifySessionToken(tokens.id_token);
    await setStoredSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      idToken: tokens.id_token,
      session,
    });
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      idToken: tokens.id_token,
      session,
    };
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function getOrRefreshStoredSession(): Promise<StoredAuthSession | null> {
  return (await getStoredSession()) ?? (await refreshStoredSession());
}

export async function logoutStoredSession(): Promise<void> {
  if (isLocalAuthDisabled()) {
    await clearStoredSession();
    return;
  }
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  await clearStoredSession();
  if (refreshToken) {
    await revokeCognitoToken(refreshToken).catch(() => undefined);
  }
}
