"use client";

// Global Topbar search: debounced fan-out to the devices/policies/violations
// BFF endpoints with a grouped results dropdown. Enter jumps to the
// violations page pre-filtered with the query.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface DeviceHit {
  device_id: string;
  hostname: string;
  last_user?: string | null;
}

interface PolicyHit {
  policy_id: string;
  name: string;
  version: number;
  status: string;
}

interface ViolationHit {
  event_id: string;
  device_id: string;
  reason: string | null;
  decision: string;
}

interface Results {
  devices: DeviceHit[];
  policies: PolicyHit[];
  violations: ViolationHit[];
}

const EMPTY: Results = { devices: [], policies: [], violations: [] };

async function fetchGroup<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(path, { credentials: "same-origin" });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: T[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

export function GlobalSearch(): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<Results>(EMPTY);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const runSearch = useCallback((q: string): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const enc = encodeURIComponent(trimmed);
      void Promise.all([
        fetchGroup<DeviceHit>(`/api/devices?search=${enc}&per_page=5`),
        fetchGroup<PolicyHit>(`/api/policies?search=${enc}&per_page=5`),
        fetchGroup<ViolationHit>(`/api/violations?search=${enc}&per_page=5`),
      ]).then(([devices, policies, violations]) => {
        setResults({ devices, policies, violations });
        setLoading(false);
      });
    }, 250);
  }, []);

  const navigate = (href: string): void => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY);
    router.push(href);
  };

  const total =
    results.devices.length + results.policies.length + results.violations.length;

  return (
    <div ref={rootRef} className="hidden md:block relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          runSearch(e.target.value);
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && query.trim()) {
            navigate(`/violations?search=${encodeURIComponent(query.trim())}`);
          }
        }}
        placeholder="Search devices, policies, violations..."
        className="w-64 pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vg-primary-500"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
      />

      {open && query.trim().length >= 2 && (
        <div
          id="global-search-results"
          className="absolute left-0 mt-2 w-96 max-h-[28rem] overflow-y-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-40"
          role="listbox"
        >
          {loading ? (
            <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              Searching…
            </p>
          ) : total === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              No matches for “{query.trim()}”. Press Enter to search violations.
            </p>
          ) : (
            <>
              {results.devices.length > 0 && (
                <SearchGroup label="Devices">
                  {results.devices.map((d) => (
                    <SearchRow
                      key={d.device_id}
                      onSelect={() =>
                        navigate(`/devices/${encodeURIComponent(d.device_id)}`)
                      }
                      title={d.hostname || d.device_id}
                      subtitle={`${d.device_id}${d.last_user ? ` · ${d.last_user}` : ""}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.policies.length > 0 && (
                <SearchGroup label="Policies">
                  {results.policies.map((p) => (
                    <SearchRow
                      key={`${p.policy_id}-${p.version}`}
                      onSelect={() =>
                        navigate(`/policies?search=${encodeURIComponent(p.name)}`)
                      }
                      title={p.name}
                      subtitle={`v${p.version} · ${p.status}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.violations.length > 0 && (
                <SearchGroup label="Violations">
                  {results.violations.map((v) => (
                    <SearchRow
                      key={v.event_id}
                      onSelect={() =>
                        navigate(
                          `/violations?search=${encodeURIComponent(v.event_id)}`
                        )
                      }
                      title={v.reason ?? v.event_id}
                      subtitle={`${v.decision} · ${v.device_id}`}
                    />
                  ))}
                </SearchGroup>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="py-1">
      <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function SearchRow({
  title,
  subtitle,
  onSelect,
}: {
  title: string;
  subtitle: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
      role="option"
      aria-selected={false}
    >
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
        {title}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>
    </button>
  );
}
