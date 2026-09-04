#!/usr/bin/env bash
# E2E Postgres on a macOS runner (no Docker there): Homebrew postgresql@16 on
# port 5433 with test/test + esign_test, matching docker-compose.test.yml.
# Ephemeral data dir under $RUNNER_TEMP - the runner is disposable anyway.
#
# No auto-update: the first `brew install` on a fresh runner otherwise spends
# ~2.5 min refreshing taps and the formula index before it downloads anything
# (measured 155 s of a 220 s step). The image's pinned index is fine for a
# throwaway test database; if it ever lacks a postgresql@16 bottle the install
# fails loudly, which is the right signal to bump the image.
set -euo pipefail
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1
TMP="${RUNNER_TEMP:-/tmp}"
brew install --quiet postgresql@16
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
