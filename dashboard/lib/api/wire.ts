import type { Page } from "@/lib/api/types";

export interface WirePage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly per_page: number;
  readonly total: number;
  readonly next_token?: string | null;
}

export function wirePage<T>(raw: WirePage<T>): Page<T> {
  return {
    items: raw.items,
    page: raw.page,
    perPage: raw.per_page,
    total: raw.total,
    nextToken: raw.next_token ?? null,
  };
}
