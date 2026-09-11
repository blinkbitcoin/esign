#!/usr/bin/env bash
# Starts the backend with the mock provider in the background and waits for
# /health. Needs the E2E Postgres up + migrated (make test-db-up; scripts/e2e/
# test-db.sh run npm run migrate:test -w packages/esign-service). Log:
# $RUNNER_TEMP/backend.log (or /tmp). CI: E2E / iOS + Android. Local: make
# e2e-backend-up. Ports from the table (scripts/lib/ports.mjs): the backend on
# ESIGN_API_PORT, the database on ESIGN_TEST_DB_PORT, CORS for the three web
# demo ports - all exported over .env.test's defaults so a moved block works.
set -euo pipefail
# shellcheck source=scripts/e2e/wait-lib.sh
. "$(dirname "$0")/wait-lib.sh"
# shellcheck source=scripts/e2e/ports-env.sh
. "$(dirname "$0")/ports-env.sh"
cd "$(dirname "$0")/../../packages/esign-service"
LOG="${RUNNER_TEMP:-/tmp}/backend.log"
PORT="$ESIGN_API_PORT" DATABASE_URL="$ESIGN_TEST_DATABASE_URL" \
  CORS_ALLOWED_ORIGINS="http://localhost:$ESIGN_WEB_PORT,http://localhost:$ESIGN_WEB_WEBFORM_PORT,http://localhost:$ESIGN_WEB_PUBLICURL_PORT" \
  ESIGN_PROVIDER=mock npx dotenv-cli -e .env.test -- npm run dev > "$LOG" 2>&1 &
wait_for backend 30 2 "$LOG" http_ok "http://localhost:$ESIGN_API_PORT/health"
