/**
 * Core type definitions for the CLI framework.
 *
 * These types define the contracts between framework components
 * and tool-specific adapters.
 */

import type { Decision, Transport } from '@vguardrail/connector-sdk';

/**
 * Context extracted from CLI arguments before policy evaluation.
 * Contains the prompt text and any files referenced by the command.
 */
export interface ExtractionContext {
  /** The user's prompt text to be sent to the AI tool */
  prompt: string;
  /** Files referenced in the command that should be included in context */
  files: Array<{
    /** Path to the file */
    path: string;
    /** Full content of the file for DLP scanning */
    content: string;
  }>;
  /**
   * Stdin content captured by the adapter for scanning. When present, the
   * executor re-supplies this data to the real tool's stdin (the wrapper
   * consumed the original stream in order to scan it).
   */
  stdinData?: string;
}

/**
 * Result of attempting to extract context from CLI arguments.
 */
export interface ExtractionResult {
  /** Whether a prompt was successfully extracted */
  found: boolean;
  /** The extracted context, if found */
  context?: ExtractionContext;
  /** Error message if extraction failed due to an error */
  error?: string;
}

/**
 * Function type for extracting context from CLI arguments.
 * Each tool adapter implements this interface.
 */
export type ContextExtractor = (args: string[]) => Promise<ExtractionResult>;

/**
 * Configuration for a specific CLI tool.
 */
export interface ToolDefinition {
  /** Unique identifier for the tool (e.g., 'claude-code', 'aider') */
  name: string;
  /** Display name for user messages */
  displayName: string;
  /** Path to the real executable to wrap */
  executablePath: string;
  /** Function to extract prompt context from arguments */
  extractContext: ContextExtractor;
  /** AI provider name (e.g., 'anthropic', 'google', 'openai') */
  provider?: string;
  /** Default model name if not specified by user */
  defaultModel?: string;
  /**
   * Opt-in profile for the best-effort PTY interactive guard. When present
   * AND the guard is enabled (VG_INTERACTIVE_GUARD=1 / --interactive-guard),
   * interactive sessions are run under a pseudo-terminal so each submitted
   * line is scanned. Absent ⇒ interactive sessions pass through unscanned.
   */
  interactive?: InteractiveProfile;
}

/**
 * Per-tool configuration for the PTY interactive guard.
 */
export interface InteractiveProfile {
  /**
   * Bytes sent to the child to clear its current input line when a typed
   * line is blocked. Defaults to Ctrl+U (`\x15`), which clears the line in
   * readline-style and most TUI inputs.
   */
  clearInputSequence?: string;
}

/**
 * Result of policy enforcement decision.
 */
export interface EnforcementResult {
  /** The original decision from the policy engine */
  decision: Decision;
  /** Whether execution should proceed */
  shouldProceed: boolean;
  /** Whether user acknowledged a warning */
  warningAcknowledged?: boolean;
  /** Error message if enforcement failed */
  error?: string;
}

/**
 * Result of process execution.
 */
export interface ExecutionResult {
  /** Exit code from the process */
  exitCode: number;
  /** Whether the process started successfully */
  started: boolean;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Configuration for the CLI connector.
 */
export interface CliConnectorConfig {
  /** Tool definition including extractor and executable path */
  tool: ToolDefinition;
  /** Whether to enable verbose logging */
  verbose?: boolean;
  /** Timeout for policy evaluation in milliseconds */
  timeoutMs?: number;
  /** Path to configuration file */
  configPath?: string;
  /** Transport override for the policy client (e.g. MockTransport in tests) */
  transport?: Transport;
}

/**
 * Options for building a ScanRequest from extraction context.
 */
export interface ScanRequestOptions {
  /** The extraction context containing prompt and files */
  context: ExtractionContext;
  /** Tool information for the scan context */
  tool: ToolDefinition;
  /** User context (resolved from environment/config) */
  user: UserContext;
  /** Repository context (resolved from current directory) */
  repo?: RepoContext;
}

/**
 * User context for policy evaluation.
 */
export interface UserContext {
  /** Unique user identifier */
  userId: string;
  /** User's role in the organization */
  role: string;
  /** Groups the user belongs to */
  groups: string[];
}

/**
 * Repository context for policy evaluation.
 */
export interface RepoContext {
  /** Repository name (e.g., 'org/project') */
  name: string;
  /** Classification level of the repository */
  classification?: string;
}