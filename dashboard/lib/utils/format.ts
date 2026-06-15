// Formatting helpers used across pages.

const RELATIVE_THRESHOLDS: readonly { limit: number; divisor: number; unit: string }[] = [
  { limit: 60, divisor: 1, unit: "second" },
  { limit: 60 * 60, divisor: 60, unit: "minute" },
  { limit: 24 * 60 * 60, divisor: 60 * 60, unit: "hour" },
  { limit: 7 * 24 * 60 * 60, divisor: 24 * 60 * 60, unit: "day" },
  { limit: 30 * 24 * 60 * 60, divisor: 7 * 24 * 60 * 60, unit: "week" },
  { limit: 365 * 24 * 60 * 60, divisor: 30 * 24 * 60 * 60, unit: "month" },
];

export function formatRelativeTime(
  ms: number | null | undefined,
  now: number = Date.now()
): string {
  if (ms === null || ms === undefined) return "—";
  const diff = Math.round((ms - now) / 1000);
  const abs = Math.abs(diff);
  const future = diff > 0;
  for (const t of RELATIVE_THRESHOLDS) {
    if (abs < t.limit) {
      const value = Math.max(1, Math.round(abs / t.divisor));
      const unit = value === 1 ? t.unit : `${t.unit}s`;
      return future ? `in ${value} ${unit}` : `${value} ${unit} ago`;
    }
  }
  const years = Math.round(abs / (365 * 24 * 60 * 60));
  const unit = years === 1 ? "year" : "years";
  return future ? `in ${years} ${unit}` : `${years} ${unit} ago`;
}

export function formatDateTime(
  ms: number | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }
): string {
  if (ms === null || ms === undefined) return "—";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
}

export function formatDate(
  ms: number | null | undefined
): string {
  return formatDateTime(ms, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function formatTime(
  ms: number | null | undefined
): string {
  return formatDateTime(ms, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function bytesToHexPreview(hash: string, length = 10): string {
  if (!hash) return "—";
  if (hash.length <= length * 2) return hash;
  return `${hash.slice(0, length)}…${hash.slice(-length)}`;
}
