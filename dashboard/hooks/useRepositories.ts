// Client-side hook that returns a live registry bound to the BFF.
//
// Pages run in the browser, so they cannot reach the Rust backend or hold the
// ID token. The registry returned here fetches the same-origin `/api/*` BFF
// routes (cookie-authenticated), which proxy to the backend. There is no mock
// data path: an unauthenticated caller is bounced to /login by middleware.

"use client";

import { useMemo } from "react";
import { createBffRepositoryRegistry } from "@/lib/api/bff-repositories";
import type { RepositoryRegistry } from "@/lib/api";

export function useRepositories(): RepositoryRegistry {
  return useMemo(() => createBffRepositoryRegistry(), []);
}
