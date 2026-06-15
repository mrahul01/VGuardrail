// Shared helpers for the live Rust-backend repositories.
//
// The Rust server (`/admin/*`) returns a snake_case pagination envelope
//   { items, total, page, per_page, next_token }
// while the dashboard's `Page<T>` contract is camelCase
//   { items, page, perPage, total, nextToken }.
// Item bodies themselves are already snake_case in both worlds (see the DTOs
// in lib/api/types.ts), so only the envelope and a few aggregate responses
// need remapping.

import type { Page } from "@/lib/api/types";
import { backendFetch, BackendClientError } from "@/lib/api/client";

/**
 * GET a single resource, mapping a backend 404 to `null` so route handlers can
 * emit a proper 404 envelope instead of a 500. Any other error propagates.
 */
export async function backendGetOrNull<T>(
  path: string,
  token?: string,
): Promise<T | null> {
  try {
    return await backendFetch<T>(path, { token });
  } catch (e) {
    if (e instanceof BackendClientError && e.status === 404) return null;
    throw e;
  }
}

/** Raw snake_case page envelope as emitted by the Rust backend. */
export interface RawPage<T> {
  readonly items?: readonly T[];
  readonly total?: number;
  readonly page?: number;
  readonly per_page?: number;
  readonly next_token?: string | null;
}

export function mapPage<T>(raw: RawPage<T>): Page<T> {
  return {
    items: raw.items ?? [],
    page: raw.page ?? 1,
    perPage: raw.per_page ?? (raw.items?.length ?? 0),
    total: raw.total ?? raw.items?.length ?? 0,
    nextToken: raw.next_token ?? null,
  };
}
