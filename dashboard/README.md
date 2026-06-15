# VGuardrail Dashboard

Next.js (App Router) admin dashboard for the VGuardrail platform: devices
(with per-device process/extension inventory and event timelines), violations,
policies, exceptions, audit chain, users, and org settings.

## Stack

- Next.js App Router + TypeScript, Tailwind CSS (class-based dark mode via
  `next-themes`), CVA-variant UI components in `components/ui/`, recharts.
- Pages call same-origin BFF routes under `app/api/*` (cookie-authenticated),
  which proxy to the Rust backend (`/admin/*`) — the browser never talks to
  the backend directly. Repositories live in `lib/api/`.
- Auth: Cognito (PKCE) in production; local mode bypasses it entirely with
  `DISABLE_AUTH=true` (mock super_admin session, backend runs with
  `VG_DEV_CLAIMS=1` and trusts `x-vg-role`/`x-vg-org-id` headers).

## Run locally

```bash
npm install
DISABLE_AUTH=true API_BASE_URL=http://localhost:8080 npm run dev   # http://localhost:3000
```

Or use the repo root `./start-local.sh`, which starts the backend stack
(docker-compose.local.yml) plus the dashboard, then `./seed-local-data.sh`
for demo data.

## Test & typecheck

```bash
npx tsc --noEmit
npm test          # vitest (one known pre-existing failure: auth cookie sameSite)
npx playwright test   # e2e (needs the local stack running)
```

## Conventions

- Category wire names come from the policy engine (`pe-core`); the display
  list lives in `types/index.ts` (`CATEGORIES`) and must stay in sync with
  the engine's enum.
- Device pages link by `device_id`; hostnames resolve client-side via
  `hooks/useDeviceNames.ts`.
