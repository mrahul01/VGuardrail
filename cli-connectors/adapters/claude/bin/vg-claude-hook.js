#!/usr/bin/env node
/**
 * VGuardrail hook for Claude Code (vg-claude-hook).
 *
 * Wired into Claude Code's UserPromptSubmit / PreToolUse hooks so prompts typed
 * inside interactive sessions — and the commands Claude runs — are scanned.
 * Reads a JSON event on stdin and emits its decision as stdout JSON.
 */

import('../dist/hook.js')
  .then((module) => module.main())
  .catch((error) => {
    // Fail closed: a non-zero exit makes Claude Code ALLOW the prompt, so on a
    // fatal loader error we BLOCK via the documented stdout contract instead.
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason: `VGuardrail hook failed to load (${error.message}) — prompt blocked (fail-closed)`,
      }),
    );
    process.exit(0);
  });
