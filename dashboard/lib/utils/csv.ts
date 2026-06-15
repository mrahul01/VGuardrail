// CSV export helpers (RFC 4180).

/** Quote a field when it contains a comma, quote, or line break. */
function escapeField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize rows to RFC 4180 CSV. Columns control both the header line and
 * the field order; missing row keys serialize as empty fields.
 */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly { key: string; header: string }[]
): string {
  const lines: string[] = [
    columns.map((c) => escapeField(c.header)).join(","),
  ];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(row[c.key])).join(","));
  }
  return lines.join("\r\n");
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
