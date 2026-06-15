// ScanService — the extension's single gateway to the connector-sdk. Builds
// ScanRequests from editor context (source:'ide', per-IDE app id, repo + file
// metadata) and always evaluates via `safeScan` so transport failures yield a
// fail-closed BLOCK decision instead of an exception.

import {
  ConnectorClient,
  type AgentStatus,
  type FileContext,
  type ScanContext,
  type ScanRequest,
  type ScanResponse,
  type Transport,
} from '@vguardrail/connector-sdk';
import type { IdeApp } from './app';
import { loadIdentity, type ConnectorIdentity } from './identity';

/** Non-content metadata captured from the active editor for a scan. */
export interface EditorPromptContext {
  filePath?: string;
  /** File extension without the dot, e.g. `ts`. */
  fileExtension?: string;
  /** Editor language id, used as the extension fallback for files without one. */
  languageId?: string;
  /** Workspace folder name, reported as the repo name. */
  workspaceName?: string;
}

export interface ScanServiceOptions {
  /** Which IDE is hosting the extension (detected from `vscode.env.appName`). */
  app: IdeApp;
  /** Injectable transport for tests (defaults to the SDK's XpcBridgeTransport). */
  transport?: Transport;
  /** Injectable identity for tests (defaults to ~/.vguardrail/connector.json). */
  identity?: ConnectorIdentity;
}

export class ScanService {
  private readonly client: ConnectorClient;
  private readonly app: IdeApp;
  private readonly identity: ConnectorIdentity;

  constructor(options: ScanServiceOptions) {
    this.app = options.app;
    this.identity = options.identity ?? loadIdentity();
    this.client = new ConnectorClient(options.transport ? { transport: options.transport } : {});
  }

  /** Builds the wire-ready ScanRequest for a prompt plus its editor context. */
  buildRequest(text: string, ctx: EditorPromptContext): ScanRequest {
    const context: ScanContext = {
      source: 'ide',
      app: this.app,
      user: {
        userId: this.identity.userId,
        role: this.identity.role,
        groups: this.identity.groups,
      },
    };
    if (ctx.workspaceName !== undefined && ctx.workspaceName.length > 0) {
      context.repo = { name: ctx.workspaceName };
    }
    if (ctx.filePath !== undefined && ctx.filePath.length > 0) {
      const file: FileContext = { path: ctx.filePath };
      // The wire format has no languageId slot; use it as the extension
      // fallback so extension-less files (Dockerfile, Makefile, …) still
      // carry a useful type hint.
      const extension = ctx.fileExtension ?? ctx.languageId;
      if (extension !== undefined && extension.length > 0) file.fileExtension = extension;
      context.file = file;
    }
    return { text, context };
  }

  /**
   * Evaluates a prompt. Never throws on availability failures: `safeScan`
   * substitutes a synthetic BLOCK decision (`fromFallback: true`) when the
   * engine is unreachable, and the remaining (validation/protocol) errors are
   * surfaced to the caller, which must also treat them as a block.
   */
  scan(text: string, ctx: EditorPromptContext): Promise<ScanResponse> {
    return this.client.safeScan(this.buildRequest(text, ctx), { fallbackAction: 'block' });
  }

  /** Current agent + engine health. Throws when the agent is unreachable. */
  status(): Promise<AgentStatus> {
    return this.client.status();
  }

  /** Records the user's response to a WARN decision (audit bookkeeping). */
  acknowledgeWarning(eventId: string, accepted: boolean): Promise<boolean> {
    return this.client.acknowledgeWarning(eventId, accepted);
  }

  /** Tears down the transport (extension deactivation). */
  close(): Promise<void> {
    return this.client.close();
  }
}
