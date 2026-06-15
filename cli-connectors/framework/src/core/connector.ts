/**
 * Main CLI Connector class that orchestrates the wrapper workflow.
 *
 * This is the primary entry point for CLI tool wrappers. It handles:
 * - Context extraction from CLI arguments
 * - Policy evaluation via the connector-sdk
 * - Decision enforcement (Allow/Warn/Block)
 * - Process execution with stdio preservation
 */

import type { Decision } from '@vguardrail/connector-sdk';

import type {
  CliConnectorConfig,
  ToolDefinition,
  ContextExtractor,
  ExtractionResult,
} from './types.js';
import { loadConfig, type FrameworkConfig } from './config.js';
import { resolveBypass, printBypassWarning } from './bypass.js';
import { resolveUserContext, type UserContext } from './user-context.js';
import { detectRepoContext, type RepoContext } from './repo-context.js';
import { PolicyClient } from '../sdk/client.js';
import { buildScanRequest } from '../sdk/scan-request.js';
import { enforceDecision } from '../policy/enforcement.js';
import { executeTool } from '../process/executor.js';
import { setupSignalHandlers } from '../process/signals.js';
import { logger } from '../util/logger.js';

/** Flag/env that opt into the best-effort PTY interactive guard. */
const INTERACTIVE_GUARD_FLAG = '--interactive-guard';
const INTERACTIVE_GUARD_ENV = 'VG_INTERACTIVE_GUARD';

/**
 * Resolves whether the PTY interactive guard is requested, stripping the flag
 * from the forwarded args (mirrors the `--bypass` strip semantics).
 */
function resolveInteractiveGuard(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; args: string[] } {
  const stripped = args.filter((arg) => arg !== INTERACTIVE_GUARD_FLAG);
  const flagPresent = stripped.length !== args.length;
  return { enabled: flagPresent || env[INTERACTIVE_GUARD_ENV] === '1', args: stripped };
}

/**
 * CLI Connector - the main wrapper class for AI CLI tools.
 *
 * Usage:
 *   const connector = new CliConnector({ tool: myToolDefinition });
 *   await connector.run(process.argv.slice(2));
 */
export class CliConnector {
  private readonly tool: ToolDefinition;
  private readonly config: FrameworkConfig;
  private readonly policyClient: PolicyClient;
  private readonly userContext: UserContext;
  private readonly repoContext?: RepoContext;

  constructor(config: CliConnectorConfig) {
    this.tool = config.tool;
    this.config = loadConfig(config.configPath);

    // Override timeout if specified
    if (config.timeoutMs !== undefined) {
      this.config.timeoutMs = config.timeoutMs;
    }

    // Initialize user context
    this.userContext = resolveUserContext(this.config.user);

    // Detect repository context
    const repoConfig = this.config.repos[`${this.tool.name}-repo`];
    this.repoContext = detectRepoContext(repoConfig) ?? undefined;

    // Initialize policy client with timeout
    this.policyClient = new PolicyClient({
      timeoutMs: this.config.timeoutMs,
      ...(config.transport !== undefined ? { transport: config.transport } : {}),
    });

    // Setup signal handling
    setupSignalHandlers();

    // Configure logging
    if (config.verbose || this.config.verbose) {
      logger.setLogLevel('debug');
    }
  }

  /**
   * Main entry point - runs the wrapper with CLI arguments.
   *
   * Flow:
   * 1. Extract context from arguments
   * 2. Build scan request
   * 3. Evaluate against policy
   * 4. Enforce decision
   * 5. Execute real tool if allowed
   */
  async run(rawArgs: string[]): Promise<void> {
    logger.debug('CLI connector starting', {
      tool: this.tool.name,
      args: rawArgs.slice(0, 3), // Log first 3 args only for privacy
    });

    // Step 0: Emergency bypass (--bypass flag or VG_BYPASS=1).
    // The flag is always stripped before forwarding to the real tool.
    const { bypass, args: afterBypass, source } = resolveBypass(rawArgs);
    if (bypass && source) {
      printBypassWarning(this.tool.displayName, source);
      // Fire-and-forget audit acknowledgement; never blocks the bypass.
      this.policyClient.acknowledgeBypass(this.tool.name).catch(() => {});
      await this.spawnReal(afterBypass);
      return;
    }

    // Strip the interactive-guard opt-in flag too (so the real tool never
    // sees it); the env form needs no stripping.
    const { enabled: guardRequested, args } = resolveInteractiveGuard(afterBypass);

    // Step 1: Extract context from CLI arguments
    const extractionResult = await this.extractContext(args);

    // If extraction had an error, fail closed (block). This must be
    // checked before the pass-through path so a failed extraction can
    // never fail open.
    if (extractionResult.error) {
      logger.debug('Extraction error, failing closed', { error: extractionResult.error });
      this.showErrorMessage(`Failed to extract prompt context (${extractionResult.error}). For security, the command cannot be executed.`);
      process.exit(1);
      return;
    }

    // If no prompt found, this is an interactive session (REPL/TUI).
    if (!extractionResult.found) {
      // Best-effort PTY guard: scan each submitted line when opted in, the
      // tool ships an interactive profile, and we have a real terminal.
      if (guardRequested && this.tool.interactive !== undefined && process.stdin.isTTY) {
        logger.debug('Interactive guard active; running under PTY');
        await this.runInteractiveGuard(args);
        return;
      }
      if (guardRequested && this.tool.interactive === undefined) {
        process.stderr.write(
          `\x1b[33m[VGuardrail] interactive guard not available for ${this.tool.displayName}; ` +
            `passing through unscanned.\x1b[0m\n`,
        );
      }
      logger.debug('No prompt detected, passing through');
      await this.spawnReal(args);
      return;
    }

    const context = extractionResult.context;
    if (!context) {
      // Should not reach here, but handle defensively
      await this.spawnReal(args);
      return;
    }

    // Step 2: Build scan request
    const scanRequest = buildScanRequest({
      context,
      tool: this.tool,
      user: this.userContext,
      ...(this.repoContext ? { repo: this.repoContext } : {}),
    });

    // Step 3: Evaluate against policy
    let decision: Decision;
    try {
      decision = await this.evaluatePolicy(scanRequest);
    } catch (error) {
      // Policy evaluation failed - fail closed
      logger.debug('Policy evaluation failed', { error });
      this.showErrorMessage('Security check unavailable. Cannot proceed.');
      process.exit(1);
      return;
    }

    // Step 4: Enforce decision
    const enforcementResult = await enforceDecision(decision);

    if (!enforcementResult.shouldProceed) {
      process.exit(1);
      return;
    }

    // Step 5: Execute real tool (re-supplying captured stdin, if any)
    await this.spawnReal(args, context.stdinData);
  }

  /**
   * Extract context from CLI arguments using the tool's extractor.
   */
  private async extractContext(args: string[]): Promise<ExtractionResult> {
    try {
      return await this.tool.extractContext(args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown extraction error';
      return {
        found: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Evaluate the scan request against the policy engine.
   * Uses safeScan to ensure fail-closed behavior.
   */
  private async evaluatePolicy(scanRequest: Parameters<PolicyClient['scan']>[0]): Promise<Decision> {
    return await this.policyClient.scan(scanRequest);
  }

  /**
   * Spawn the real executable with inherited stdio.
   *
   * @param args - Arguments to forward verbatim
   * @param stdinData - Captured stdin to re-supply (when the adapter
   *                    consumed the piped input for scanning)
   */
  private async spawnReal(args: string[], stdinData?: string): Promise<void> {
    const result = await executeTool({
      executable: this.tool.executablePath,
      args,
      ...(stdinData !== undefined ? { stdinData } : {}),
    });

    // Exit with the same code as the child process
    process.exit(result.exitCode);
  }

  /**
   * Run the tool under the PTY interactive guard (best-effort per-line
   * scanning). Imported lazily so the native node-pty module is only loaded
   * when the guard is actually used. If the PTY cannot be created we fail
   * closed: the interactive session is refused rather than passed through.
   */
  private async runInteractiveGuard(args: string[]): Promise<void> {
    try {
      const { runPtySession } = await import('../process/pty-session.js');
      const exitCode = await runPtySession({
        tool: this.tool,
        args,
        user: this.userContext,
        ...(this.repoContext !== undefined ? { repo: this.repoContext } : {}),
        client: this.policyClient,
      });
      process.exit(exitCode);
    } catch (error) {
      logger.debug('Interactive guard failed to start; failing closed', { error });
      this.showErrorMessage(
        'Interactive guard could not start a protected session. For security, the session was not opened.',
      );
      process.exit(1);
    }
  }

  /**
   * Show an error message to the user.
   */
  private showErrorMessage(message: string): void {
    process.stderr.write(`\x1b[31m[VGuardrail] ${message}\x1b[0m\n`);
  }
}

/**
 * Create a tool definition with the given configuration.
 */
export function createToolDefinition(config: {
  name: string;
  displayName: string;
  executablePath: string;
  extractContext: ContextExtractor;
  provider?: string;
  defaultModel?: string;
  interactive?: ToolDefinition['interactive'];
}): ToolDefinition {
  return {
    name: config.name,
    displayName: config.displayName,
    executablePath: config.executablePath,
    extractContext: config.extractContext,
    provider: config.provider,
    defaultModel: config.defaultModel,
    ...(config.interactive !== undefined ? { interactive: config.interactive } : {}),
  };
}