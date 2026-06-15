// Per-IDE identification. VS Code, Cursor, Windsurf, Trae, and Antigravity
// all load the same extension build; the actual host is detected at runtime
// from `vscode.env.appName` so scan context (`context.app`) reports the real
// IDE without needing per-fork source trees.

export type IdeApp = 'vscode' | 'cursor' | 'windsurf' | 'trae' | 'antigravity';

/** Maps a `vscode.env.appName` value onto the connector's app identifier. */
export function detectIdeApp(appName: string): IdeApp {
  const name = appName.toLowerCase();
  if (name.includes('cursor')) return 'cursor';
  if (name.includes('windsurf')) return 'windsurf';
  if (name.includes('trae')) return 'trae';
  if (name.includes('antigravity')) return 'antigravity';
  return 'vscode';
}
