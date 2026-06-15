# VGuardrail IDE connectors

Pre-send DLP scanning inside developer IDEs. Every connector evaluates text
against the same local stack — `com.vguardrail.agent.xpc` (vguardiand) → Rust
policy engine — and every one is **fail-closed**: when the engine is
unreachable the verdict is BLOCK with an explicit "policy engine unavailable"
message, never a silent allow.

All IDE connectors are **advisory pre-send checks**. No IDE exposes a public
API to intercept prompts typed into AI chat panels (Cursor chat, Windsurf
Cascade, Copilot Chat, JetBrains AI Assistant, Xcode Intelligence) — guaranteed
enforcement is the job of VGuardrail's agent/network layer, and each README
says so explicitly.

## Connectors

| Directory | Covers | Transport to the agent | Status |
| --- | --- | --- | --- |
| [`vscode/`](vscode/) | VS Code, Cursor, Windsurf, Trae, Antigravity (one shared extension; per-IDE `.vsix` packaging + runtime `app` detection) | `@vguardrail/connector-sdk` → `xpc-bridge` helper; or `"vguardrail.transport": "http-dev"` → the local dev backend's `/scan` (same real detector pipeline, no signed bridge needed) | Built, typechecked, unit-tested (vitest). |
| [`jetbrains/`](jetbrains/) | IntelliJ-platform IDEs 2024.1+ (IDEA, PyCharm, WebStorm, …) — scan actions, decision balloons, decision-history tool window | Spawns the Node bridge in [`jetbrains/bridge/`](jetbrains/bridge/) per request | Bridge built + tested. Plugin Kotlin sources are complete but **not compiled here** (no JDK/Gradle on this machine); build with JDK 17 + `gradle wrapper --gradle-version 8.7 && ./gradlew buildPlugin`. |
| [`xcode/`](xcode/) | Xcode (Source Editor Extension: "Scan Selection with VGuardrail") | Self-contained `NSXPCConnection` client (no bridge, no framework) | Sources parse-verified with `xcrun swiftc -parse` (XcodeKit paths behind `#if canImport(XcodeKit)`). The `.xcodeproj` must be created once in the Xcode GUI — Apple ships **no converter** for source-editor extensions; `scripts/setup.sh` verifies sources and prints the exact steps. |
| `cursor/` | (historical) Cursor MVP spike | — | Superseded by `vscode/`; kept as reference only, no longer typechecks against the current SDK. |

## What is honestly NOT covered by any IDE connector

- **Zed** — not a VS Code fork; it cannot load VS Code extensions and has no
  VGuardrail extension. Zed users are covered by the agent/CLI layers only.
- **Codex desktop (`Codex.app`, com.openai.codex)** — a plain Electron app,
  not a VS Code fork: it has no extension API, so nothing can be installed
  into it. Coverage: the `vg-codex` CLI wrapper (the desktop app and CLI share
  the same account/tasks), and the agent's process inventory tags it
  `ai_desktop`.
- **Antigravity agent manager (`Antigravity.app`, com.google.antigravity)** —
  also plain Electron. The extension targets the editor fork
  **`Antigravity IDE.app`** (CLI `antigravity-ide`), which is what loads
  `.vsix` files.
- **In-IDE AI extensions** (Cline, Roo Code, Continue, GitHub Copilot, Amazon
  Q, Gemini Code Assist) — our VS Code extension runs alongside them and the
  passive paste watcher gives advisory coverage of ordinary documents, but
  their chat prompts are not interceptable from another extension.
  Interception of their network traffic belongs to the agent-level layer.
- **Bundled AI chat UIs** in every IDE — see each connector's "Honest
  limitations" section.

## Decision UX (shared semantics)

allow → silent/info · warn → warning with Proceed/Cancel where the platform
allows it (VS Code family, JetBrains; **not** Xcode — its extensions cannot
present UI, so WARN surfaces as a failed-command alert) · block → error with
the engine's reason and finding categories · engine down → explicit
"policy engine unavailable" block.
