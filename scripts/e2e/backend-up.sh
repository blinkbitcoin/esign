#!/usr/bin/env bash
# Starts the backend with the mock provider in the background and waits for
# /health. Needs the E2E Postgres up + migrated (make test-db-up; npm run
# migrate:test -w apps/api). Log: $RUNNER_TEMP/backend.log (or /tmp).
# CI: E2E / iOS + Android. Local: make e2e-backend-up.
set -euo pipefail
cd "$(dirname "$0")/../../apps/api"
LOG="${RUNNER_TEMP:-/tmp}/backend.log"
ESIGN_PROVIDER=mock npx dotenv-cli -e .env.test -- npm run dev > "$LOG" 2>&1 &
for i in {1..30}; do
  if curl -s http://localhost:4000/health > /dev/null; then
    echo "Backend is ready"; exit 0
  fi
  echo "Waiting for backend... ($i/30)"; sleep 2
done
echo "ERROR: Backend failed to start"; tail -50 "$LOG" || true; exit 1
