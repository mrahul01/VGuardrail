# VGuardrail Browser Connectors

One shared WebExtension (MV3) gates prompts on AI websites (ChatGPT, Claude,
Gemini, Copilot, Perplexity, …): the content script intercepts the send
action, the background worker scans the text, and warn/block decisions render
as an in-page modal. Scanning goes to the native messaging host
(`com.vguardrail.connector` → agent → policy engine) when installed, falling
back to the local dev backend (`POST http://localhost:8080/scan`). Fail-closed:
if no transport answers, the prompt is blocked.

## Layout

- `chrome/extension/` — the canonical extension source (TypeScript, esbuild).
  All other browsers reuse this build.
- `chrome/native-host/` — native messaging host manifest + bridge binary glue.
- `edge/`, `brave/`, `firefox/` — thin per-browser packaging (manifest tweaks,
  store metadata) over the same source.
- `safari/` — Safari Web Extension wrapper. Safari cannot load unpacked
  extensions: `scripts/convert.sh` runs `xcrun safari-web-extension-converter`
  (requires **full Xcode**, not just CLT), overlays the XPC handler, inserts
  the mach-lookup entitlement for `com.vguardrail.agent.xpc`, builds with
  ad-hoc signing, and opens the app. Web AI providers are added to the shared
  provider registry — never as separate fetch-patching adapter files.

## Build & load (Chrome / Edge / Brave)

```bash
cd chrome/extension
npm install && npm run build      # esbuild → dist/ (unpacked extension)
```

`chrome://extensions` (or `edge://extensions`, `brave://extensions`) →
Developer mode → **Load unpacked** → `dist/`. Reload the extension after every
rebuild. Firefox: `about:debugging` → Load Temporary Add-on (uses the firefox
manifest packaging).

## Test

```bash
cd chrome/extension && npm test
```

For end-to-end local testing, start the backend stack first (repo root
`./start-local.sh`); the extension registers the device on the fly and every
scan decision appears in the dashboard's violations/audit pages.
