# VGuardrail CLI Connectors

CLI protection framework for AI development tools. Each supported tool gets a
`vg-<tool>` wrapper that extracts the prompt from the command line, evaluates
it against the local VGuardrail policy engine, and only then executes the real
binary with the original arguments forwarded verbatim.

## Architecture

```
User
  ↓
vg-<tool> [args...]
  ↓
CLI Connector (adapter + framework)
  ↓
connector-sdk
  ↓
xpc-bridge
  ↓
Agent
  ↓
Policy Engine
```

## Project Structure

```
cli-connectors/
├── framework/              # Core framework (TypeScript)
│   └── src/
│       ├── core/          # Core types, config, connector, bypass
│       ├── sdk/           # Policy client, scan request builder
│       ├── process/       # Process execution, signal handling
│       ├── policy/        # Decision enforcement, prompts
│       └── util/          # File ops, executable resolution, stdin, logging
├── adapters/              # Tool-specific adapters
│   ├── claude/           # Claude Code adapter (vg-claude)
│   ├── gemini/           # Gemini CLI adapter (vg-gemini)
│   ├── codex/            # OpenAI Codex CLI adapter (vg-codex)
│   ├── aider/            # Aider adapter (vg-aider)
│   ├── ollama/           # Ollama adapter (vg-ollama)
│   ├── llama/            # llama.cpp adapter (vg-llama)
│   ├── mlx/              # MLX LM adapter (vg-mlx)
│   ├── sgpt/             # Shell-GPT adapter (vg-sgpt)
│   └── gh-copilot/       # GitHub Copilot CLI adapter (vg-gh-copilot)
├── scripts/
│   └── install-wrappers.sh  # Build + install/uninstall launchers
└── shared/               # Legacy shared code (deprecated)
```

## Supported Tools

| Tool               | Wrapper         | Provider    | Package                              |
|--------------------|-----------------|-------------|--------------------------------------|
| Claude Code        | `vg-claude`     | `anthropic` | `@vguardrail/cli-adapter-claude`     |
| Gemini CLI         | `vg-gemini`     | `google`    | `@vguardrail/cli-adapter-gemini`     |
| Codex CLI          | `vg-codex`      | `openai`    | `@vguardrail/cli-adapter-codex`      |
| Aider              | `vg-aider`      | `aider`     | `@vguardrail/cli-adapter-aider`      |
| Ollama             | `vg-ollama`     | `ollama`    | `@vguardrail/cli-adapter-ollama`     |
| llama.cpp          | `vg-llama`      | `llama-cpp` | `@vguardrail/cli-adapter-llama`      |
| MLX LM             | `vg-mlx`        | `mlx`       | `@vguardrail/cli-adapter-mlx`        |
| Shell-GPT          | `vg-sgpt`       | `sgpt`      | `@vguardrail/cli-adapter-sgpt`       |
| GitHub Copilot CLI | `vg-gh-copilot` | `github`    | `@vguardrail/cli-adapter-gh-copilot` |

> **Warp / Wave terminals are out of scope** for CLI wrapping: their AI
> features have no stable CLI prompt surface to intercept (prompts are
> entered inside the terminal app itself, not as command-line arguments).
> Agent-level interception covers them instead.

## Decision Behavior

Every scanned invocation receives a policy decision:

- **ALLOW** — the real tool is executed immediately, with all original
  arguments forwarded verbatim and stdio inherited (colors, interactivity,
  and exit codes are preserved).
- **WARN** — the decision (reason + findings) is shown and the user is asked
  to confirm. The tool runs only after explicit acknowledgement; declining
  exits non-zero. The acknowledgement is reported back to the agent for audit.
- **BLOCK** — the decision and reason are displayed and the wrapper exits
  non-zero. The real tool is never started.

### Fail-Closed Posture

The wrappers fail closed at every layer:

- If the policy engine / agent / XPC bridge is unreachable, the SDK's
  `safeScan` returns a synthetic **BLOCK** decision (reason:
  `policy engine unavailable; fail-closed "block" applied` or
  `connector unavailable (<code>); fail-closed "block" applied`).
- If prompt extraction fails with an error (e.g. an unreadable
  `--message-file`), the command is blocked.
- Unknown decision actions are treated as BLOCK.

Invocations with **no extractable prompt** (`--help`, maintenance subcommands
like `codex login`) pass through without scanning — there is no content to
evaluate; a notice is printed where relevant.

**Interactive sessions** (a bare `claude` / `codex` / `gemini` REPL) carry no
command-line prompt, so the argument-level wrappers cannot scan them. Two
mechanisms cover the inside-the-session case — see below.

## Interactive sessions

Prompts typed *inside* an interactive REPL never appear on the command line, so
they need a different interception point than the `vg-*` wrappers.

### Claude Code — native hooks (deterministic, recommended)

Claude Code exposes a hook system that fires on every submitted prompt and
before every tool call, in both interactive and `claude -p "…"` runs. The
`vg-claude-hook` binary plugs into it:

```bash
cd cli-connectors
./scripts/install-wrappers.sh        # installs vg-claude-hook alongside the wrappers
./scripts/install-claude-hook.sh     # merges the hook entries into ~/.claude/settings.json
```

- **`UserPromptSubmit`** — every prompt is scanned before Claude sees it.
  - allow → silent.
  - block / high / critical → the prompt is **rejected** (erased from context)
    with the engine's reason; no override.
  - medium → rejected once with a notice; **resubmit the same prompt within 60
    seconds** to acknowledge and proceed (a hook cannot show a Proceed/Cancel
    dialog, so resubmission is the explicit acknowledgement).
  - low → allowed, with a warning added to the context.
- **`PreToolUse` (Bash)** — commands Claude itself runs are scanned; a
  block/high decision **denies** the command (e.g. destructive commands,
  credential exfiltration).

Fail-closed: any error (malformed input, engine unreachable) blocks the prompt.
The hook is enforced through Claude Code's settings; there is no runtime bypass
flag. For org-wide enforcement that users cannot remove, replicate the entries
into `/Library/Application Support/ClaudeCode/managed-settings.json` with
`"allowManagedHooksOnly": true`. Remove with
`./scripts/install-claude-hook.sh --uninstall`.

### Other tools — best-effort PTY guard (opt-in)

`codex` and `gemini` have no hook system, so their interactive REPLs are
covered by an opt-in pseudo-terminal guard that scans each line as you press
Enter:

```bash
VG_INTERACTIVE_GUARD=1 vg-codex      # or: vg-codex --interactive-guard
VG_INTERACTIVE_GUARD=1 vg-gemini
```

Keystrokes are forwarded immediately (typing stays responsive); only Enter is
gated. On a block/high decision the newline is swallowed and the input box is
cleared, so the line never reaches the tool; medium uses the same
resubmit-to-acknowledge flow as the hook; low prints a notice and proceeds.

This is **best-effort, not a guarantee**: a full-screen TUI or cursor editing
(arrow keys, history recall) can desync the reconstructed line — such lines are
flagged internally and still scanned, but the reconstruction may be
approximate. It is off by default for that reason. Where a deterministic hook
exists (Claude Code), prefer it. The guard fails closed: if a line's scan
cannot complete, the line is blocked.

## Emergency Bypass (`--bypass`)

For incidents where the policy engine itself is the outage:

```bash
vg-claude --bypass "restore the production config"
# or
VG_BYPASS=1 vg-claude "restore the production config"
```

Bypass behavior, uniform across all wrappers:

- The scan is skipped entirely and the real tool runs.
- A loud, unmissable warning is printed to stderr.
- A fire-and-forget audit acknowledgement (`bypass:<tool>:<timestamp>`) is
  sent to the agent so the bypass leaves a trace; failures to record it never
  block the bypass.
- `--bypass` is stripped before the arguments are forwarded — the wrapped
  tool never sees it. Only the exact argument `--bypass` is treated as the
  flag (and only `VG_BYPASS=1` activates the env form).

## Install / Uninstall

```bash
cd cli-connectors

# Build framework + all adapters and install launchers into /usr/local/bin
./scripts/install-wrappers.sh

# Install somewhere user-writable instead (no sudo)
PREFIX=$HOME/.local ./scripts/install-wrappers.sh

# Also recommend shell aliases (claude -> vg-claude, ...) and optionally
# append them to ~/.zshrc after explicit confirmation
./scripts/install-wrappers.sh --shadow

# Re-install launchers without rebuilding
./scripts/install-wrappers.sh --skip-build

# Remove the launchers and the ~/.zshrc alias block
./scripts/install-wrappers.sh --uninstall
```

Notes:

- The script is idempotent; re-running replaces launchers and the alias block
  in place.
- It **never** renames, moves, or modifies the original tool binaries.
  Shadowing is done purely with shell aliases, added only after you confirm.
- If `/usr/local/bin` is not writable it falls back to `sudo` with a clear
  message; use `PREFIX` to avoid sudo entirely.
- Uninstall only removes launchers that carry the generated-file marker.

### Alias recursion safety

The wrappers resolve the *real* binary themselves (env override such as
`VG_GEMINI_PATH`, then a PATH scan that skips VGuardrail launchers and
anything symlinked back to them, then well-known install locations), so
`alias gemini='vg-gemini'` can never recurse into the wrapper.

## Prompt Extraction Rules

What each wrapper scans, per tool:

### `vg-claude` (Claude Code)

- First positional argument, or `--prompt <text>` / `--prompt="text"`.
- `--read <file>` contents are read and included in the scan.
- No prompt, no stdin, no files → interactive session, passed through.

### `vg-gemini` (Gemini CLI)

- Positional arguments joined into one prompt, or `-p` / `--prompt <text>` /
  `--prompt="text"`.
- `-i` / `--interactive` → scan skipped with a notice (prompts typed inside
  the session are not intercepted unless the PTY guard is enabled — see
  [Interactive sessions](#interactive-sessions)).
- Piped stdin is captured, scanned, and re-supplied to the real tool.
- No prompt at all → pass-through with a notice.

### `vg-codex` (Codex CLI)

- Positional arguments joined, including the `codex exec <prompt>` form.
- Maintenance subcommands (`login`, `logout`, `mcp`, `completion`, `resume`,
  ...) pass through unscanned.
- Piped stdin (e.g. `cat task.md | vg-codex exec -`) is captured, scanned,
  and re-supplied.
- Bare interactive `codex` REPL → pass-through unless the PTY guard is enabled
  (see [Interactive sessions](#interactive-sessions)).

### `vg-aider` (Aider)

- `--message` / `--msg` / `-m <text>` (and `=` forms).
- `--message-file <path>`: the file is read and its contents scanned; an
  unreadable message file **blocks** the command (fail closed).
- Plain `aider` with no message launches interactive mode → scan skipped with
  a notice that interactive sessions are not intercepted.

### `vg-ollama` (Ollama)

- `ollama run <model> [prompt words...]`: the words after the model are the
  prompt (flags and their values are skipped).
- `ollama run <model>` with piped stdin: stdin is captured, scanned, and
  re-supplied; with no prompt and no stdin it is an interactive REPL →
  pass-through with a notice.
- Any other subcommand (`pull`, `list`, `serve`, ...) → maintenance
  pass-through with a notice. `chat` is an interactive session and cannot be
  intercepted per-message; the notice says so.

### `vg-llama` (llama.cpp)

- `-p` / `--prompt <text>` (and `=` forms).
- `-f` / `--file <path>`: the prompt file is read and its contents scanned;
  an unreadable file **blocks** the command (fail closed).
- No prompt flag → interactive session, passed through with a notice.
- The real binary is resolved as `llama-cli`, then `main`, then `llama`
  (the CLI has been renamed across llama.cpp versions); `VG_LLAMA_BIN`
  overrides resolution.

### `vg-mlx` (MLX LM, `mlx_lm.generate`)

- `--prompt <text>` / `--prompt="text"`.
- `--prompt -` with piped stdin: stdin is captured, scanned, and
  re-supplied.
- No `--prompt` → pass-through with a notice. `VG_MLX_BIN` overrides the
  real-binary resolution.

### `vg-sgpt` (Shell-GPT)

- The first positional argument is the prompt (`sgpt "<prompt>"`); values of
  value-taking flags (`--model`, `--temperature`, ...) are never mistaken for
  it.
- `--chat <session> <prompt>`: the session id is skipped, the prompt is
  scanned.
- `--repl <session>` is an interactive REPL → pass-through with a notice.
- Piped stdin is captured, scanned, and re-supplied.

### `vg-gh-copilot` (GitHub Copilot CLI)

- `gh copilot suggest "<prompt>"` and `gh copilot explain "<command>"`: the
  positional after the subcommand is scanned (`-t`/`--target` and
  `--hostname` values are skipped).
- `gh copilot` alone, or `suggest`/`explain` without an inline prompt, is
  interactive → pass-through with a notice.
- Any other `gh` invocation (`gh pr`, `gh api`, ...) passes through. The
  **full original argv** is always forwarded to the real `gh`.

In all cases the original arguments are forwarded to the real binary
unchanged (except for stripping `--bypass`).

## Environment Variables

| Variable        | Description                                   |
|-----------------|-----------------------------------------------|
| `VG_BYPASS`     | `1` activates the emergency bypass            |
| `VG_INTERACTIVE_GUARD` | `1` enables the best-effort PTY guard for interactive sessions (codex/gemini) |
| `VG_VERBOSE`    | `1` enables debug logging                     |
| `VG_CLAUDE_PATH`| Override path to the real Claude executable   |
| `VG_GEMINI_PATH`| Override path to the real Gemini executable   |
| `VG_CODEX_PATH` | Override path to the real Codex executable    |
| `VG_AIDER_PATH` | Override path to the real Aider executable    |
| `VG_OLLAMA_PATH`| Override path to the real Ollama executable   |
| `VG_LLAMA_BIN`  | Override path to the real llama.cpp executable|
| `VG_MLX_BIN`    | Override path to the real mlx_lm.generate     |
| `VG_SGPT_PATH`  | Override path to the real Shell-GPT executable|
| `VG_GH_PATH`    | Override path to the real gh executable       |
| `VG_REPO_NAME`  | Override repository name                      |
| `VG_REPO_CLASSIFICATION` | Override repository classification   |
| `XDG_CONFIG_HOME` | Override config directory location          |

## Configuration

Create `~/.config/vguardrail/cli-config.json`:

```json
{
  "user": {
    "id": "your-user-id",
    "role": "user",
    "groups": ["engineering"]
  },
  "repos": {
    "my-company/secret-project": {
      "classification": "confidential"
    }
  }
}
```

## Development

```bash
# Framework
cd framework
npm install
npm run build
npm test          # vitest unit tests (enforcement, bypass, executable resolution, ...)

# An adapter (after the framework is built)
cd ../adapters/gemini
npm install
npm run build
```

### Adding a New Adapter

1. Create `adapters/<tool-name>/` mirroring an existing adapter
   (`package.json` with a `vg-<tool>` bin, `tsconfig.json`, `bin/`, `src/`).
2. Implement `extractContext()` for the tool's CLI syntax, returning an
   `ExtractionResult` (`{ found, context?, error? }`).
3. Resolve the real binary with `resolveRealExecutable()` so aliasing cannot
   recurse.
4. Add the tool to `scripts/install-wrappers.sh` (`TOOLS` + `PACKAGES`).

## Security Considerations

Key controls:

- Fail-closed on engine unavailability, extraction errors, and unknown
  decisions
- No prompt/file content in logs
- Stdio inheritance (no output tampering); captured stdin is faithfully
  re-supplied
- Signal forwarding to the child process
- Loud, audited emergency bypass

## License

MIT
