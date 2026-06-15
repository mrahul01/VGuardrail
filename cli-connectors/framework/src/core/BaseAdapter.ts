/**
 * Base adapter class for CLI tool adapters.
 *
 * Provides a common interface for executing CLI tools with
 * proper error handling, timeout support, and signal propagation.
 */

export interface AdapterResponse {
  content?: string;
  metadata?: Record<string, unknown>;
  status: 'success' | 'error';
  error?: string;
}

export interface ExecutionOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export abstract class BaseAdapter {
  abstract execute(prompt: string, options: ExecutionOptions): Promise<AdapterResponse>;
}