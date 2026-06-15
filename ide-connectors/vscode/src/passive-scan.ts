// PassiveScanController — best-effort, advisory paste monitoring.
//
// There is no public VS Code API to intercept text entered into AI chat
// webviews (see README "Honest limitations"). What IS feasible is watching
// `onDidChangeTextDocument` for paste-sized insertions into ordinary documents
// and surfacing a non-blocking warning when that content would be flagged or
// blocked by policy. This controller never prevents an edit — it only warns.
//
// Like the interceptor, this file imports no `vscode` types: documents and
// changes arrive as plain structural values so the logic is unit-testable.

import type { ScanResponse } from '@vguardrail/connector-sdk';
import { blockMessage, warnMessage } from './interceptor';
import type { EditorPromptContext } from './scan-service';

/** Insertions longer than this are treated as pastes worth scanning. */
export const PASTE_THRESHOLD_CHARS = 200;
/** Documents larger than this are skipped entirely (per policy: 256 KiB). */
export const MAX_DOCUMENT_BYTES = 256 * 1024;
/** Quiet window before a burst of paste events is scanned once. */
export const DEFAULT_DEBOUNCE_MS = 750;

export const PASSIVE_ENGINE_DOWN_MESSAGE =
  'VGuardrail: policy engine unavailable — passive paste scanning is degraded';

/** The slice of a text document the controller needs. */
export interface PassiveDocument extends EditorPromptContext {
  /** Stable identity for debouncing (e.g. `uri.toString()`). */
  uri: string;
  /** URI scheme; only `file` and `untitled` documents are scanned. */
  scheme: string;
  /** Size of the full document content in bytes. */
  byteLength: number;
}

export interface PassiveScanOptions {
  /** Evaluates pasted text (typically `ScanService.scan`). */
  scan(text: string, ctx: EditorPromptContext): Promise<ScanResponse>;
  /** Non-blocking warning notification. */
  notify(message: string): void;
  /** Live gate: `vguardrail.enabled && vguardrail.passiveScan`. */
  isEnabled(): boolean;
  debounceMs?: number;
}

const SCANNABLE_SCHEMES: ReadonlySet<string> = new Set(['file', 'untitled']);

interface PendingScan {
  ctx: EditorPromptContext;
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

export function passiveMessage(response: ScanResponse): string | undefined {
  const { decision } = response;
  switch (decision.action) {
    case 'warn':
      return `Pasted content — ${warnMessage(decision)}`;
    case 'block':
      return `Pasted content — ${blockMessage(decision)}`;
    case 'allow':
      return undefined;
  }
}

export class PassiveScanController {
  private readonly scan: PassiveScanOptions['scan'];
  private readonly notify: PassiveScanOptions['notify'];
  private readonly isEnabled: PassiveScanOptions['isEnabled'];
  private readonly debounceMs: number;

  private readonly pending = new Map<string, PendingScan>();
  /** Engine-down is reported once, then muted until a scan succeeds again. */
  private engineDownNotified = false;
  private disposed = false;

  constructor(options: PassiveScanOptions) {
    this.scan = options.scan;
    this.notify = options.notify;
    this.isEnabled = options.isEnabled;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Feeds one document-change event. Paste-sized insertions are accumulated
   * per document and scanned after a quiet window; everything else is ignored.
   */
  handleChange(document: PassiveDocument, insertedTexts: readonly string[]): void {
    if (this.disposed || !this.isEnabled()) return;
    if (!SCANNABLE_SCHEMES.has(document.scheme)) return;
    if (document.byteLength > MAX_DOCUMENT_BYTES) return;

    const pasted = insertedTexts.filter((text) => text.length > PASTE_THRESHOLD_CHARS);
    if (pasted.length === 0) return;

    const existing = this.pending.get(document.uri);
    if (existing !== undefined) clearTimeout(existing.timer);

    const text = (existing !== undefined ? [existing.text, ...pasted] : pasted).join('\n');
    const ctx: EditorPromptContext = {
      filePath: document.filePath,
      fileExtension: document.fileExtension,
      languageId: document.languageId,
      workspaceName: document.workspaceName,
    };
    const timer = setTimeout(() => {
      void this.flush(document.uri);
    }, this.debounceMs);
    this.pending.set(document.uri, { ctx, text, timer });
  }

  /** Cancels timers; subsequent events are ignored. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  private async flush(uri: string): Promise<void> {
    const entry = this.pending.get(uri);
    this.pending.delete(uri);
    if (entry === undefined || this.disposed) return;

    let response: ScanResponse;
    try {
      response = await this.scan(entry.text, entry.ctx);
    } catch {
      // Passive scanning is advisory: a hard failure is reported like
      // engine-down (once), never escalated.
      this.reportEngineDown();
      return;
    }

    if (response.fromFallback) {
      this.reportEngineDown();
      return;
    }
    this.engineDownNotified = false;

    const message = passiveMessage(response);
    if (message !== undefined) this.notify(message);
  }

  private reportEngineDown(): void {
    if (this.engineDownNotified) return;
    this.engineDownNotified = true;
    this.notify(PASSIVE_ENGINE_DOWN_MESSAGE);
  }
}
