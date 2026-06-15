/**
 * Process execution module for spawning real CLI tools.
 *
 * Handles spawning the actual CLI tool with proper stdio inheritance
 * and exit code propagation.
 */

import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { SIGNAL_NUMBERS } from './signals.js';
import type { ExecutionResult } from '../core/types.js';

export type { ExecutionResult };

/**
 * Options for executing a tool.
 */
export interface ExecutionOptions {
  /** Path to the executable to run */
  executable: string;
  /** Arguments to pass to the executable */
  args: string[];
  /** Working directory for the process */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /**
   * Data to supply on the child's stdin. Used when the wrapper consumed
   * piped stdin to scan it; stdout/stderr remain inherited.
   */
  stdinData?: string;
}

/**
 * Execute a tool with inherited stdio.
 *
 * This function spawns the real executable with stdio inherited from
 * the parent process, ensuring that colors, interactive prompts, and
 * all output are preserved exactly as the tool would produce them.
 *
 * @param options - Execution options
 * @returns Promise that resolves when the process exits
 */
export function executeTool(options: ExecutionOptions): Promise<ExecutionResult> {
  return new Promise<ExecutionResult>((resolve) => {
    const supplyStdin = options.stdinData !== undefined;
    const spawnOptions: SpawnOptions = {
      // Inherit stdout/stderr always; pipe stdin only when re-supplying
      // captured input (the wrapper consumed the original stream to scan it).
      stdio: supplyStdin ? ['pipe', 'inherit', 'inherit'] : 'inherit',
      env: {
        ...process.env,
        ...options.env,
      },
    };

    if (options.cwd) {
      spawnOptions.cwd = options.cwd;
    }

    let child: ChildProcess;

    try {
      child = spawn(options.executable, options.args, spawnOptions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      process.stderr.write(`[VGuardrail] Failed to spawn ${options.executable}: ${errorMessage}\n`);
      resolve({
        exitCode: 1,
        started: false,
        error: errorMessage,
      });
      return;
    }

    if (supplyStdin && child.stdin) {
      child.stdin.on('error', () => {
        // Child may exit before consuming stdin (EPIPE); not fatal.
      });
      child.stdin.write(options.stdinData as string);
      child.stdin.end();
    }

    child.on('exit', (code, signal) => {
      // Convert signal to exit code (128 + signal number)
      const exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] || 1) : 1);
      resolve({
        exitCode,
        started: true,
      });
    });

    child.on('error', (error) => {
      const errorMessage = error.message;
      process.stderr.write(`[VGuardrail] Process error: ${errorMessage}\n`);
      resolve({
        exitCode: 1,
        started: false,
        error: errorMessage,
      });
    });
  });
}

/**
 * Execute a tool and capture its output.
 *
 * Unlike executeTool, this function captures stdout/stderr instead of
 * inheriting them. Use this for testing or when you need to process output.
 *
 * @param options - Execution options
 * @returns Promise that resolves with output and exit code
 */
export function executeToolCaptured(options: ExecutionOptions): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  started: boolean;
}> {
  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'], // Don't inherit stdio
      env: {
        ...process.env,
        ...options.env,
      },
    };

    if (options.cwd) {
      spawnOptions.cwd = options.cwd;
    }

    let stdout = '';
    let stderr = '';

    let child: ChildProcess;

    try {
      child = spawn(options.executable, options.args, spawnOptions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: errorMessage,
        started: false,
      });
      return;
    }

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    child.on('exit', (code, signal) => {
      const exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] || 1) : 1);
      resolve({
        exitCode,
        stdout,
        stderr,
        started: true,
      });
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
        started: false,
      });
    });
  });
}