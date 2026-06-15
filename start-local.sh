#!/usr/bin/env bash
# ============================================================
#  start-local.sh — Start the full VGuardrail stack locally
#
#  Usage:
#    ./start-local.sh          # Start infra + dashboard + vguardiand agent
#    ./start-local.sh infra    # Start only DynamoDB + MinIO + backend
#    ./start-local.sh stop     # Stop all services (including the agent)
#
#  No demo data is seeded — only real registered devices appear in the
#  dashboard. Run ./seed-local-data.sh separately if you want demo rows.
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[VGuardrail]${NC} $*"; }
warn() { echo -e "${YELLOW}[VGuardrail]${NC} $*"; }
err()  { echo -e "${RED}[VGuardrail]${NC} $*"; }

AGENT_PID_FILE="$SCRIPT_DIR/.vguardiand.pid"
AGENT_LOG="$SCRIPT_DIR/.vguardiand.log"

AGENT_LAUNCHD="$HOME/Library/LaunchAgents/com.vguardrail.agent.local.plist"
ENGINE_LAUNCHD="$HOME/Library/LaunchAgents/com.vguardrail.policy-engine.local.plist"

stop_all() {
  log "Stopping all services..."
  if [ -f "$AGENT_LAUNCHD" ]; then
    launchctl bootout "gui/$(id -u)/com.vguardrail.agent.local" 2>/dev/null || true
    log "vguardiand LaunchAgent stopped."
  fi
  if [ -f "$ENGINE_LAUNCHD" ]; then
    launchctl bootout "gui/$(id -u)/com.vguardrail.policy-engine.local" 2>/dev/null || true
    log "pe-engined LaunchAgent stopped."
  fi
  if [ -f "$AGENT_PID_FILE" ]; then
    kill "$(cat "$AGENT_PID_FILE")" 2>/dev/null || true
    rm -f "$AGENT_PID_FILE"
  fi
  pkill -f '\.build/debug/vguardiand' 2>/dev/null || true
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  docker compose -f docker-compose.local.yml down 2>/dev/null || true
  log "All services stopped."
}

start_agent() {
  # The endpoint enforcement chain runs as two user LaunchAgents:
  #   pe-engined  — Rust policy engine on /tmp/vguardrail/policy.sock
  #   vguardiand  — Swift agent owning the XPC mach service
  #                 com.vguardrail.agent.xpc (launchd must own the mach name,
  #                 a bare process cannot register it), gRPC client to the
  #                 engine, device registration + inventory uploads.
  # Both plists are created once (see README); here we just (re)start them.
  if [ -f "$ENGINE_LAUNCHD" ]; then
    launchctl bootstrap "gui/$(id -u)" "$ENGINE_LAUNCHD" 2>/dev/null || true
    launchctl kickstart "gui/$(id -u)/com.vguardrail.policy-engine.local" 2>/dev/null || true
    log "pe-engined LaunchAgent running (log: /tmp/vguardrail/pe-engined.log)."
  else
    warn "pe-engined LaunchAgent plist missing ($ENGINE_LAUNCHD) — XPC scans will fail closed."
  fi
  if [ -f "$AGENT_LAUNCHD" ]; then
    launchctl bootstrap "gui/$(id -u)" "$AGENT_LAUNCHD" 2>/dev/null || true
    launchctl kickstart "gui/$(id -u)/com.vguardrail.agent.local" 2>/dev/null || true
    log "vguardiand LaunchAgent running (log: /tmp/vguardrail/vguardiand.err.log)."
  else
    warn "vguardiand LaunchAgent plist missing ($AGENT_LAUNCHD) — connectors cannot reach the agent."
  fi
}

start_infra() {
  log "Starting infrastructure (DynamoDB + MinIO + Backend)..."
  docker compose -f docker-compose.local.yml up -d dynamodb-local minio backend
  log "Waiting for backend to be healthy..."
  for i in $(seq 1 30); do
    if curl -s http://localhost:8080/health 2>/dev/null | grep -q '"status":"healthy"'; then
      log "Backend is healthy ✓"
      return 0
    fi
    sleep 1
  done
  warn "Backend health check timed out — it may still be starting."
}

start_dashboard() {
  log "Starting dashboard on http://localhost:3000 ..."
  cd dashboard

  if [ ! -d "node_modules" ]; then
    log "Installing dashboard dependencies..."
    npm install --silent
  fi

  # Ensure the port is free
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  sleep 1

  DISABLE_AUTH=true npm run dev &
  DASH_PID=$!
  cd "$SCRIPT_DIR"

  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w '' http://localhost:3000/ 2>/dev/null; then
      log "Dashboard is ready ✓"
      return 0
    fi
    sleep 1
  done
  warn "Dashboard may still be starting (PID $DASH_PID)."
}

verify() {
  log "Verifying services..."
  echo ""
  echo "  Health:    $(curl -s http://localhost:8080/health 2>/dev/null | head -c 80)"
  echo "  Stats:     $(curl -s -H 'x-vg-role: super_admin' -H 'x-vg-org-id: org-local' http://localhost:8080/admin/stats 2>/dev/null | head -c 80)"
  echo "  Session:   $(curl -s http://localhost:3000/api/auth/session 2>/dev/null | head -c 80)"
  echo "  Dashboard: http://localhost:3000"
  echo "  MinIO:     http://localhost:9001 (minioadmin/minioadmin)"
  echo ""
}

case "${1:-up}" in
  stop|down)
    stop_all
    ;;
  infra)
    start_infra
    verify
    ;;
  up|"")
    start_infra
    start_agent
    start_dashboard
    verify
    log ""
    log "Stack is running! Open http://localhost:3000 in your browser."
    log "To stop: $0 stop"
    ;;
  *)
    echo "Usage: $0 [up|infra|stop]"
    exit 1
    ;;
esac