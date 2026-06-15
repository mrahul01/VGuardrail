import { cookies } from "next/headers";
import type { UserSession } from "@/types/auth";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE,
  clearStoredSession,
  getStoredSession,
  refreshStoredSession,
  setStoredSession,
} from "@/lib/auth/session-store";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 15, // 15 minutes for access token
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days for refresh token
};

/** Set auth cookies after successful login */
export async function setAuthCookies(
  accessToken: string,
  refreshToken: string,
  session: UserSession
): Promise<void> {
  await setStoredSession({
    accessToken,
    refreshToken,
    idToken: accessToken,
    session,
  });
}

/** Clear all auth cookies on logout */
export async function clearAuthCookies(): Promise<void> {
  await clearStoredSession();
}

/** Get access token from cookies */
export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value || null;
}

/** Get refresh token from cookies */
export async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value || null;
}

/** Get session from cookies */
export async function getSession(): Promise<UserSession | null> {
  return (await getStoredSession())?.session ?? null;
}

/** Update session cookie (e.g., after role change) */
export async function updateSession(session: UserSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
    ...COOKIE_OPTIONS,
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Refresh access token and update cookies */
export async function refreshSession(
  refreshToken: string,
  newAccessToken: string
): Promise<void> {
  void refreshToken;
  void newAccessToken;
  await refreshStoredSession();
}
