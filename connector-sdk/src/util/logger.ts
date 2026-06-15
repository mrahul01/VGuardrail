// Pluggable structured logger. The SDK logs only non-sensitive metadata
// (method names, request ids, error codes, latencies) — NEVER prompt text,
// finding previews, or spans. Connectors inject their own logger; the default
// is a no-op so the SDK is silent unless asked to speak.

export interface LogFields {
  [key: string]: string | number | boolean | undefined;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** A logger that discards everything (default). */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A JSON-lines logger over `console`, for connectors that want SDK logs. */
export function consoleLogger(): Logger {
  const emit = (level: string, message: string, fields?: LogFields): void => {
    const line = JSON.stringify({ level, message, ...fields });
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
