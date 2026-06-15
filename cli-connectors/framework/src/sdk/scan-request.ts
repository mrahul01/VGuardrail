/**
 * ScanRequest builder for converting extraction context to policy requests.
 *
 * This module handles the transformation from CLI-specific extraction
 * results to the standardized ScanRequest format expected by the policy engine.
 */

import type { ScanRequest, ScanContext, Source } from '@vguardrail/connector-sdk';
import type {
  ExtractionContext,
  ToolDefinition,
  UserContext,
  RepoContext,
  ScanRequestOptions,
} from '../core/types.js';

/**
 * Maximum prompt length in characters.
 * Prompts exceeding this will be truncated.
 */
const MAX_PROMPT_LENGTH = 100000;

/**
 * Build a ScanRequest from extraction context and metadata.
 */
export function buildScanRequest(options: ScanRequestOptions): ScanRequest {
  const { context, tool, user } = options;

  // Build the scan context
  const scanContext = createScanContext({
    tool,
    user,
    ...(options.repo !== undefined ? { repo: options.repo } : {}),
  });

  // Fold prompt, captured stdin, and referenced file contents into the
  // scanned text (the wire ScanRequest carries content in `text` only),
  // then truncate if necessary.
  const promptText = truncatePrompt(composeScanText(context));

  return {
    text: promptText,
    context: scanContext,
  };
}

/**
 * Compose the text to scan from the extraction context.
 *
 * The policy engine receives a single text payload, so captured stdin and
 * referenced file contents are appended to the prompt with lightweight
 * delimiters. Duplicated content (stdin already used as the prompt) is
 * not repeated.
 */
function composeScanText(context: ExtractionContext): string {
  const parts: string[] = [];

  if (context.prompt) {
    parts.push(context.prompt);
  }

  if (context.stdinData && context.stdinData !== context.prompt && !context.prompt.includes(context.stdinData)) {
    parts.push(`--- stdin ---\n${context.stdinData}`);
  }

  for (const file of context.files) {
    if (context.prompt && context.prompt.includes(file.content)) {
      continue;
    }
    parts.push(`--- file: ${file.path} ---\n${file.content}`);
  }

  return parts.join('\n\n');
}

/**
 * Create a ScanContext from tool, user, and repo information.
 */
export function createScanContext(options: {
  tool: ToolDefinition;
  user: UserContext;
  repo?: RepoContext;
}): ScanContext {
  const { tool, user, repo } = options;

  const context: ScanContext = {
    source: 'cli' as Source,
    app: tool.name,
    user: {
      userId: user.userId,
      role: user.role as ScanContext['user']['role'],
      groups: user.groups,
    },
  };

  if (tool.provider) {
    context.provider = tool.provider;
  }

  if (repo !== undefined) {
    const repoContext: ScanContext['repo'] = {
      name: repo.name,
    };
    if (repo.classification !== undefined) {
      repoContext.classification = repo.classification as import('@vguardrail/connector-sdk').Classification;
    }
    context.repo = repoContext;
  }

  return context;
}

/**
 * Truncate a prompt to the maximum allowed length.
 */
function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_LENGTH) {
    return prompt;
  }
  return prompt.slice(0, MAX_PROMPT_LENGTH) + '\n... [truncated]';
}

/**
 * Create extraction context from prompt and files.
 * Utility function for tool adapters.
 */
export function createExtractionContext(options: {
  prompt: string;
  files?: Array<{ path: string; content: string }>;
  stdinData?: string;
}): ExtractionContext {
  return {
    prompt: options.prompt,
    files: options.files || [],
    ...(options.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
  };
}