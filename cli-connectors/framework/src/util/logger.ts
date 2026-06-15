/**
 * Structured logging utility module.
 *
 * Provides consistent logging across the framework with
 * appropriate log levels and privacy-preserving output.
 */

/**
 * Log levels for the framework.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Log level priorities for comparison.
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Current log level.
 */
let currentLogLevel: LogLevel = 'warn';

/**
 * Set the current log level.
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Log a debug message (only shown when verbose mode is enabled).
 *
 * IMPORTANT: Never log prompt content, file content, or secrets.
 * Only log metadata and operational information.
 */
export function debug(message: string, fields?: Record<string, unknown>): void {
  if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.debug) {
    log('debug', message, fields);
  }
}

/**
 * Log an info message.
 */
export function info(message: string, fields?: Record<string, unknown>): void {
  if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.info) {
    log('info', message, fields);
  }
}

/**
 * Log a warning message.
 */
export function warn(message: string, fields?: Record<string, unknown>): void {
  if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.warn) {
    log('warn', message, fields);
  }
}

/**
 * Log an error message.
 */
export function error(message: string, fields?: Record<string, unknown>): void {
  if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.error) {
    log('error', message, fields);
  }
}

/**
 * Internal log function.
 */
function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const sanitizedFields = sanitizeFields(fields);

  if (level === 'error' || level === 'warn') {
    // Errors and warnings go to stderr
    if (sanitizedFields && Object.keys(sanitizedFields).length > 0) {
      process.stderr.write(`[${timestamp}] [VGuardrail] [${level.toUpperCase()}] ${message} ${JSON.stringify(sanitizedFields)}\n`);
    } else {
      process.stderr.write(`[${timestamp}] [VGuardrail] [${level.toUpperCase()}] ${message}\n`);
    }
  } else {
    // Debug and info go to stdout
    if (sanitizedFields && Object.keys(sanitizedFields).length > 0) {
      process.stdout.write(`[${timestamp}] [VGuardrail] [${level.toUpperCase()}] ${message} ${JSON.stringify(sanitizedFields)}\n`);
    } else {
      process.stdout.write(`[${timestamp}] [VGuardrail] [${level.toUpperCase()}] ${message}\n`);
    }
  }
}

/**
 * Sanitize fields to ensure no sensitive data is logged.
 *
 * This removes known sensitive field names and truncates long values.
 */
function sanitizeFields(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) {
    return undefined;
  }

  // Fields that should never be logged
  const sensitiveFields = [
    'prompt',
    'text',
    'content',
    'secret',
    'password',
    'token',
    'apiKey',
    'api_key',
    'authorization',
    'credential',
  ];

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some((sf) => lowerKey.includes(sf))) {
      // Replace sensitive values with a placeholder
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 1000) {
      // Truncate long string values
      sanitized[key] = value.slice(0, 1000) + '...';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a child logger with additional context.
 */
export function createChildLogger(context: Record<string, string>) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) =>
      debug(message, { ...context, ...fields }),
    info: (message: string, fields?: Record<string, unknown>) =>
      info(message, { ...context, ...fields }),
    warn: (message: string, fields?: Record<string, unknown>) =>
      warn(message, { ...context, ...fields }),
    error: (message: string, fields?: Record<string, unknown>) =>
      error(message, { ...context, ...fields }),
  };
}

/**
 * The default logger instance.
 */
export const logger = {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
  createChildLogger,
};