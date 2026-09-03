#!/usr/bin/env bash
# Waits for the E2E Postgres (docker-compose.test.yml) to accept connections.
# `docker compose up --wait` already blocks on the healthcheck; this is the
# explicit pg_isready confirmation the backend suite relied on.
set -euo pipefail
cd "$(dirname "$0")/../.."
for i in {1..30}; do
  if docker compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U test -d esign_test; then
    echo "Database is ready"; exit 0
  fi
  echo "Waiting for database... ($i/30)"; sleep 2
done
echo "ERROR: Database failed to become ready after 60 seconds"; exit 1
