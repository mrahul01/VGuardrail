# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the VGuardrail dashboard (Next.js, standalone).
#
#   deps      — npm install (cached).
#   builder   — `next build` with `output: 'standalone'`.
#   runtime   — Alpine + Node + the standalone bundle.
#
# Environment variables
#   BACKEND_API_URL   — internal URL the BFF uses to reach the Rust
#                       server (e.g. `http://backend:8080`).
#   NEXT_PUBLIC_*     — values that are baked at build time.
#
# Required at runtime (provided by `docker-compose.yml` or k8s):
#   COGNITO_ISSUER, COGNITO_CLIENT_ID, COGNITO_JWT_SECRET, etc.
#

# ── 1. deps ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. builder ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY dashboard ./
RUN npm run build

# ── 3. runtime ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Create non-root user (uid 1001).
RUN addgroup -S -g 1001 nodejs \
 && adduser  -S -D -u 1001 -G nodejs nextjs

# Copy the standalone build, public assets, and the static .next/ dir.
COPY --from=builder --chown=nextjs:nodejs /app/public            ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

USER nextjs
EXPOSE 3000

# `server.js` is the entry Next.js generates for standalone output.
CMD ["node", "server.js"]
