#!/usr/bin/env bash
# E2E Postgres on a macOS runner (no Docker there): Homebrew postgresql@16 on
# port 5433 with test/test + esign_test, matching docker-compose.test.yml.
# Ephemeral data dir under $RUNNER_TEMP - the runner is disposable anyway.
set -euo pipefail
TMP="${RUNNER_TEMP:-/tmp}"
brew install postgresql@16
PGBIN="$(brew --prefix postgresql@16)/bin"
echo "test" > "$TMP/pgpass"
"$PGBIN/initdb" -D "$TMP/pgdata" -U test --pwfile="$TMP/pgpass"
"$PGBIN/pg_ctl" -D "$TMP/pgdata" -o "-p 5433" -l "$TMP/pg.log" start
for i in {1..15}; do
  if "$PGBIN/pg_isready" -h localhost -p 5433 -U test; then break; fi
  echo "Waiting for database... ($i/15)"; sleep 2
done
"$PGBIN/createdb" -h localhost -p 5433 -U test esign_test
"$PGBIN/pg_isready" -h localhost -p 5433 -U test -d esign_test
