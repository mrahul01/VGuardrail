// Shared schema-version constant and small codec helpers.
//
// The wire `schema` string is the same one the Swift agent stamps onto audit
// events (agent/Sources/VGCore/AuditEvent.swift: "vguardrail.event/v1"). Every
// decode validates against it so an unknown schema fails loudly rather than
// being silently coerced.

/** Canonical model schema version stamped on audit events. */
export const SCHEMA_VERSION = 'vguardrail.event/v1' as const;

/**
 * Returns a shallow copy of `obj` with keys whose value is `undefined` removed.
 * Used by the wire encoders so optional fields are omitted (matching Swift's
 * `encodeIfPresent`) rather than emitted as `null`.
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const value = obj[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Deterministic JSON encoding (recursively sorted keys, slashes unescaped) used
 * for storage and signing — byte-compatible with the Swift agent's
 * `canonicalJSON()` (`.sortedKeys` + `.withoutEscapingSlashes`).
 *
 * `JSON.stringify` already leaves `/` unescaped, so only key ordering needs
 * normalizing.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
