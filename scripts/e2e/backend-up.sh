#!/usr/bin/env bash
# Starts the backend with the mock provider in the background and waits for
# /health. Needs the E2E Postgres up + migrated (make test-db-up; npm run
# migrate:test -w examples/full-service-demo). Log: $RUNNER_TEMP/backend.log (or /tmp).
# CI: E2E / iOS + Android. Local: make e2e-backend-up. Port: ESIGN_API_PORT
# (ESIGN_PORT_BASE + 0, default 4100; scripts/lib/ports.mjs).
set -euo pipefail
# shellcheck source=scripts/e2e/wait-lib.sh
. "$(dirname "$0")/wait-lib.sh"
# shellcheck source=scripts/e2e/ports-env.sh
. "$(dirname "$0")/ports-env.sh"
cd "$(dirname "$0")/../../examples/full-service-demo"
LOG="${RUNNER_TEMP:-/tmp}/backend.log"
PORT="$ESIGN_API_PORT" ESIGN_PROVIDER=mock npx dotenv-cli -e .env.test -- npm run dev > "$LOG" 2>&1 &
wait_for backend 30 2 "$LOG" http_ok "http://localhost:$ESIGN_API_PORT/health"
