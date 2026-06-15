"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly retry: () => void;
}

export function useAsyncRepo<T>(
  task: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[]
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const retryRef = useRef(0);

  const retry = useCallback(() => {
    retryRef.current += 1;
    setLoading(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    task(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error("Request failed"));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryRef.current]);

  return { data, loading, error, retry };
}

