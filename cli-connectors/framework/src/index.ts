// @vguardrail/cli-framework - Core framework for VGuardrail CLI connectors
//
// This framework provides the foundation for building CLI tool wrappers
// that intercept prompts, evaluate them against local policy, and enforce
// Allow/Warn/Block decisions before allowing tool execution.
//
// Quick start:
//   import { CliConnector, createExtractor } from '@vguardrail/cli-framework';
//   const connector = new CliConnector({ toolName: 'claude-code', ... });
//   await connector.run(process.argv.slice(2));

// ── Core ─────────────────────────────────────────────────────────────────────
export {
  CliConnector,
  createToolDefinition,
} from './core/connector.js';

export type {
  CliConnectorConfig,
  ToolDefinition,
  InteractiveProfile,
  ExtractionContext,
  ExtractionResult,
  ContextExtractor,
} from './core/types.js';

export {
  resolveBypass,
  printBypassWarning,
  BYPASS_FLAG,
  BYPASS_ENV_VAR,
  type BypassResolution,
} from './core/bypass.js';

export {
  loadConfig,
  defaultConfig,
  type FrameworkConfig,
  type UserConfig,
  type ToolConfig,
} from './core/config.js';

export {
  resolveUserContext,
  getUserFromEnv,
  type UserContext,
} from './core/user-context.js';

export {
  detectRepoContext,
  getRepoName,
  type RepoContext,
} from './core/repo-context.js';

// ── SDK ──────────────────────────────────────────────────────────────────────
export {
  PolicyClient,
  type PolicyClientOptions,
} from './sdk/client.js';

export {
  buildScanRequest,
  createScanContext,
  createExtractionContext,
} from './sdk/scan-request.js';

export {
  enforceDecision,
  handleWarning,
  warnTier,
  type EnforcementResult,
  type WarnTier,
} from './policy/enforcement.js';

// ── Process ──────────────────────────────────────────────────────────────────
export {
  executeTool,
  type ExecutionOptions,
  type ExecutionResult,
} from './process/executor.js';

export {
  setupSignalHandlers,
  forwardSignal,
} from './process/signals.js';

// ── Policy ───────────────────────────────────────────────────────────────────
export {
  showWarningPrompt,
  showWarningMessage,
  showBlockMessage,
} from './policy/prompt.js';

// ── Types (re-exported from connector-sdk) ───────────────────────────────────
export type {
  Decision,
  ScanRequest,
  ScanContext,
  Finding,
  Action,
  RiskLevel,
  Classification,
} from '@vguardrail/connector-sdk';

// ── Utilities ────────────────────────────────────────────────────────────────
export {
  readFileContent,
  readFiles,
  truncateContent,
  MAX_FILE_SIZE,
} from './util/file.js';

export {
  resolveRealExecutable,
  type ResolveExecutableOptions,
} from './util/executable.js';

export {
  isStdinPiped,
  readStdin,
  MAX_STDIN_SIZE,
} from './util/stdin.js';

export {
  logger,
  setLogLevel,
  type LogLevel,
} from './util/logger.js';

export {
  validatePath,
  sanitizePath,
} from './util/validation.js';

export {
  prepareXpcEnvironment,
  DEFAULT_BRIDGE_PATH,
} from './util/xpc-env.js';

export {
  consumeOrRecordAck,
  ackKey,
  ACK_WINDOW_MS,
  type AckStoreOptions,
} from './util/ack-store.js';

export {
  LineReconstructor,
  type SubmittedLine,
} from './process/line-reconstructor.js';

export {
  runPtySession,
  type PtySessionOptions,
} from './process/pty-session.js';