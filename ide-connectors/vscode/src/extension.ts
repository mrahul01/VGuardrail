// Extension entry point — the only file that touches the `vscode` API.
// Wires the testable core (ScanService / PromptInterceptor /
// PassiveScanController) to commands, configuration, the status bar, and
// document-change events. Hosted unchanged by VS Code, Cursor, and Windsurf;
// the per-IDE app id is detected at runtime.

import * as path from 'node:path';
import * as vscode from 'vscode';

import { detectIdeApp, type IdeApp } from './app';
import { HttpDevTransport } from './http-dev-transport';
import { prepareXpcEnvironment } from './xpc-env';
import { PromptInterceptor, type DecisionUi, type InterceptOutcome } from './interceptor';
import { MAX_DOCUMENT_BYTES, PassiveScanController, type PassiveDocument } from './passive-scan';
import { ScanService, type EditorPromptContext, type ScanServiceOptions } from './scan-service';

const CONFIG_SECTION = 'vguardrail';

let service: ScanService | undefined;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function isEnabled(): boolean {
  return config().get<boolean>('enabled', true);
}

function isPassiveScanEnabled(): boolean {
  return isEnabled() && config().get<boolean>('passiveScan', true);
}

// ── Status bar ────────────────────────────────────────────────────────────────

type StatusState = 'ready' | 'disabled' | 'allow' | 'warn' | 'block' | 'unavailable';

function updateStatusBar(item: vscode.StatusBarItem, state: StatusState, detail?: string): void {
  const labels: Record<StatusState, string> = {
    ready: 'ready',
    disabled: 'disabled',
    allow: 'allowed',
    warn: 'warned',
    block: 'blocked',
    unavailable: 'engine down',
  };
  item.text = `$(shield) VGuardrail: ${labels[state]}`;
  item.tooltip = detail ?? 'VGuardrail — click for engine status';
  switch (state) {
    case 'warn':
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'block':
    case 'unavailable':
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
    default:
      item.backgroundColor = undefined;
  }
}

function statusFromOutcome(item: vscode.StatusBarItem, outcome: InterceptOutcome): void {
  const { decision } = outcome.response;
  if (outcome.response.fromFallback) {
    updateStatusBar(item, 'unavailable', decision.reason);
    return;
  }
  updateStatusBar(item, decision.action, decision.reason);
}

// ── Editor context capture ────────────────────────────────────────────────────

function workspaceNameFor(uri: vscode.Uri | undefined): string | undefined {
  if (uri !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder !== undefined) return folder.name;
  }
  return vscode.workspace.name;
}

function extensionOf(fsPath: string): string | undefined {
  const ext = path.extname(fsPath);
  return ext.length > 1 ? ext.slice(1) : undefined;
}

function contextFromDocument(document: vscode.TextDocument): EditorPromptContext {
  const ctx: EditorPromptContext = { languageId: document.languageId };
  if (document.uri.scheme === 'file') {
    ctx.filePath = document.uri.fsPath;
    const ext = extensionOf(document.uri.fsPath);
    if (ext !== undefined) ctx.fileExtension = ext;
  }
  const workspaceName = workspaceNameFor(document.uri);
  if (workspaceName !== undefined) ctx.workspaceName = workspaceName;
  return ctx;
}

function contextFromActiveEditor(): EditorPromptContext {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    const workspaceName = workspaceNameFor(undefined);
    return workspaceName !== undefined ? { workspaceName } : {};
  }
  return contextFromDocument(editor.document);
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const app: IdeApp = detectIdeApp(vscode.env.appName);
  // Transport selection: "xpc" (production: signed bridge → vguardiand →
  // pe-engined) or "http-dev" (local development: the dev backend's /scan,
  // same real detector pipeline the browser extensions use on localhost).
  const options: ScanServiceOptions = { app };
  if (config().get<string>('transport', 'xpc') === 'http-dev') {
    options.transport = new HttpDevTransport({
      baseUrl: config().get<string>('devBackendUrl', 'http://localhost:8080'),
    });
  } else {
    // GUI-launched IDEs have no shell PATH and the local agent may be a user
    // LaunchAgent; fill in VG_XPC_BRIDGE_PATH / VG_XPC_USER_AGENT before the
    // SDK spawns the bridge.
    prepareXpcEnvironment();
  }
  const scanService = new ScanService(options);
  service = scanService;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.name = 'VGuardrail';
  statusBar.command = 'vguardrail.status';
  updateStatusBar(statusBar, isEnabled() ? 'ready' : 'disabled');
  statusBar.show();
  context.subscriptions.push(statusBar);

  const ui: DecisionUi = {
    showWarning: (message, ...actions) =>
      Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
  };
  const interceptor = new PromptInterceptor(scanService, ui, (outcome) =>
    statusFromOutcome(statusBar, outcome),
  );

  const requireEnabled = (): boolean => {
    if (isEnabled()) return true;
    void vscode.window.showInformationMessage(
      'VGuardrail is disabled — run "VGuardrail: Toggle Enabled" to re-enable scanning.',
    );
    return false;
  };

  const scanText = async (text: string, ctx: EditorPromptContext): Promise<void> => {
    const outcome = await interceptor.intercept(text, ctx);
    if (outcome.allowed) {
      const note =
        outcome.response.decision.action === 'warn'
          ? 'VGuardrail: warning acknowledged — safe to send.'
          : 'VGuardrail: prompt allowed — safe to send.';
      void vscode.window.showInformationMessage(note);
    }
  };

  // ── Commands ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('vguardrail.status', async () => {
      try {
        const status = await scanService.status();
        const engine = status.engineServing ? 'engine serving' : 'engine NOT serving';
        void vscode.window.showInformationMessage(
          `VGuardrail (${app}): ${engine} · policy v${status.activePolicyVersion} · ` +
            `${status.queuedEvents} queued events · agent ${status.agentVersion}`,
        );
        updateStatusBar(statusBar, isEnabled() ? 'ready' : 'disabled');
      } catch {
        void vscode.window.showWarningMessage(
          'VGuardrail: policy engine unavailable — prompts will be blocked (fail-closed).',
        );
        updateStatusBar(statusBar, 'unavailable');
      }
    }),

    vscode.commands.registerCommand('vguardrail.scanSelection', async () => {
      if (!requireEnabled()) return;
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        void vscode.window.showInformationMessage('VGuardrail: no active editor to scan.');
        return;
      }
      let text = editor.document.getText(editor.selection);
      if (text.length === 0) {
        // Empty selection: scan the whole document (bounded by the size cap).
        if (Buffer.byteLength(editor.document.getText(), 'utf8') > MAX_DOCUMENT_BYTES) {
          void vscode.window.showInformationMessage(
            'VGuardrail: select a region to scan — this document exceeds the 256 KiB scan cap.',
          );
          return;
        }
        text = editor.document.getText();
      }
      if (text.trim().length === 0) {
        void vscode.window.showInformationMessage('VGuardrail: nothing to scan.');
        return;
      }
      await scanText(text, contextFromDocument(editor.document));
    }),

    vscode.commands.registerCommand('vguardrail.scanPrompt', async () => {
      if (!requireEnabled()) return;
      const prompt = await vscode.window.showInputBox({
        prompt: 'Prompt to scan with VGuardrail before sending to an AI provider',
        placeHolder: 'Paste or type the prompt…',
        ignoreFocusOut: true,
      });
      if (prompt === undefined || prompt.trim().length === 0) return;
      await scanText(prompt, contextFromActiveEditor());
    }),

    vscode.commands.registerCommand('vguardrail.toggleEnabled', async () => {
      const next = !isEnabled();
      await config().update('enabled', next, vscode.ConfigurationTarget.Global);
      updateStatusBar(statusBar, next ? 'ready' : 'disabled');
      void vscode.window.showInformationMessage(
        next ? 'VGuardrail enabled.' : 'VGuardrail disabled — prompts are no longer scanned.',
      );
    }),
  );

  // ── Passive paste scanning ──────────────────────────────────────────────────

  const passive = new PassiveScanController({
    scan: (text, ctx) => scanService.scan(text, ctx),
    notify: (message) => {
      void vscode.window.showWarningMessage(message);
    },
    isEnabled: isPassiveScanEnabled,
  });
  context.subscriptions.push({ dispose: () => passive.dispose() });

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) return;
      const document: PassiveDocument = {
        uri: event.document.uri.toString(),
        scheme: event.document.uri.scheme,
        byteLength: Buffer.byteLength(event.document.getText(), 'utf8'),
        ...contextFromDocument(event.document),
      };
      passive.handleChange(
        document,
        event.contentChanges.map((change) => change.text),
      );
    }),
  );

  console.log(`VGuardrail IDE connector active (host: ${app}).`);
}

export function deactivate(): Thenable<void> | undefined {
  const closing = service?.close();
  service = undefined;
  return closing;
}

// Re-exported so embedders and tests can reference the exact UI strings.
export { CANCEL_ACTION, ENGINE_UNAVAILABLE_MESSAGE, PROCEED_ACTION } from './interceptor';
