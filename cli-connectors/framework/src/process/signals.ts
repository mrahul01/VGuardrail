/**
 * Signal handling for the CLI framework.
 *
 * Ensures proper signal forwarding and cleanup when the wrapper
 * process receives signals like SIGINT, SIGTERM, etc.
 */

/**
 * Signal numbers for converting signals to exit codes.
 * Exported for use by executor.ts for exit code calculation.
 */
export const SIGNAL_NUMBERS: Record<string, number> = {
  SIGINT: 2,
  SIGTERM: 15,
  SIGHUP: 1,
  SIGQUIT: 3,
  SIGABRT: 6,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGCONT: 18,
  SIGCHLD: 17,
  SIGBUS: 10,
  SIGFPE: 8,
  SIGSEGV: 11,
};

/**
 * Whether signal handlers have been set up.
 */
let handlersInstalled = false;

/**
 * Child process to forward signals to (set by executeTool).
 */
let childPid: number | null = null;

/**
 * Set up signal handlers for the process.
 *
 * This should be called once at startup to ensure proper
 * signal handling throughout the application lifecycle.
 */
export function setupSignalHandlers(): void {
  if (handlersInstalled) {
    return;
  }

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    handleSignal('SIGINT');
  });

  // Handle SIGTERM
  process.on('SIGTERM', () => {
    handleSignal('SIGTERM');
  });

  // Handle SIGHUP
  process.on('SIGHUP', () => {
    handleSignal('SIGHUP');
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    process.stderr.write(`[VGuardrail] Uncaught exception: ${error.message}\n`);
    process.exit(1);
  });

  handlersInstalled = true;
}

/**
 * Handle a received signal.
 */
function handleSignal(signal: NodeJS.Signals): void {
  if (childPid !== null) {
    // Forward signal to child process
    try {
      process.kill(childPid, signal);
    } catch {
      // Child may have already exited
    }
  }

  // Exit with appropriate code (128 + signal number)
  const signalNumber = SIGNAL_NUMBERS[signal] || 1;
  process.exit(128 + signalNumber);
}

/**
 * Set the child process PID for signal forwarding.
 */
export function setChildPid(pid: number): void {
  childPid = pid;
}

/**
 * Clear the child process PID.
 */
export function clearChildPid(): void {
  childPid = null;
}

/**
 * Forward a signal to the child process.
 */
export function forwardSignal(signal: NodeJS.Signals): void {
  if (childPid !== null) {
    try {
      process.kill(childPid, signal);
    } catch {
      // Child may have already exited
    }
  }
}