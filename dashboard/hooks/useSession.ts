// Client-side hook that surfaces the current authenticated user session.
//
// Backed by the REAL Cognito session: NextAuth's `useSession()` polls
// `/api/auth/session`, which reads the httpOnly cookies set by the OAuth
// code-flow callback. No mock identity is fabricated — unauthenticated users
// are bounced to `/login` by `middleware.ts` before these pages render, so the
// only non-authenticated state seen here is the brief client-hydration window,
// during which we expose a least-privilege (`viewer`) placeholder.

"use client";

import { useSession as useNextAuthSession } from "next-auth/react";

import type { Role, UserSession } from "@/types/auth";

export interface UseSessionResult {
  readonly session: UserSession;
  readonly role: Role;
  readonly status: "authenticated" | "loading" | "unauthenticated";
}

// Least-privilege placeholder used only while the session is loading on the
// client. It is NOT an authenticated identity (empty ids, `viewer` role).
const LOADING_PLACEHOLDER: UserSession = {
  id: "",
  email: "",
  role: "viewer",
  orgId: "",
  orgName: "",
  groups: [],
};

export function useSession(): UseSessionResult {
  const { data, status } = useNextAuthSession();
  // `/api/auth/session` returns our UserSession under `user`; NextAuth's default
  // user type is narrower, so cast through `unknown`.
  const user = (data?.user as unknown as UserSession | undefined) ?? LOADING_PLACEHOLDER;
  return {
    session: user,
    role: user.role,
    status,
  };
}
