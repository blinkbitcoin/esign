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
#
# Modes: `start` (default) installs, inits and starts the server; `wait`
# blocks until esign_test accepts connections. The iOS job runs `start` in
# the background right after checkout (`background`, which also records the
# PID and log for `wait`) so the install overlaps npm ci, Maestro, the
# simulator pick and Metro, then calls `wait` right before migrations.
set -euo pipefail
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1
TMP="${RUNNER_TEMP:-/tmp}"
MODE="${1:-start}"
SETUP_LOG="$TMP/pg-setup.log"

wait_for_db() {
  # The background install has no PGBIN until brew is done; poll pg_isready
  # from wherever it lands. Up to 5 min: the whole install is ~1 min warm.
  # HOMEBREW_PREFIX is exported on the runner images; `brew --prefix` itself
  # costs ~20 s of Ruby startup on a busy runner, so only fall back to it.
  local pgbin="" candidate
  candidate="${HOMEBREW_PREFIX:-$(brew --prefix)}/opt/postgresql@16/bin"
  for i in {1..150}; do
    if [ -z "$pgbin" ] && [ -x "$candidate/pg_isready" ]; then pgbin="$candidate"; fi
    if [ -n "$pgbin" ] && "$pgbin/pg_isready" -q -h localhost -p 5433 -U test -d esign_test; then
      echo "Database ready after $((i * 2))s"; return 0
    fi
    if [ -f "$TMP/pg-setup.pid" ] && ! kill -0 "$(cat "$TMP/pg-setup.pid")" 2>/dev/null \
       && ! grep -q "^SETUP_OK$" "$SETUP_LOG" 2>/dev/null; then
      echo "::error::Background Postgres setup exited before the database was ready"; break
    fi
    sleep 2
  done
  echo "--- $SETUP_LOG ---"; cat "$SETUP_LOG" 2>/dev/null || true
  echo "::error::Database not ready after $((i * 2))s"; return 1
}

case "$MODE" in
  wait) wait_for_db; exit $? ;;
  background)
    nohup bash "$0" start > "$SETUP_LOG" 2>&1 &
    echo $! > "$TMP/pg-setup.pid"
    echo "Postgres setup started in the background (pid $(cat "$TMP/pg-setup.pid"), log $SETUP_LOG)"
    exit 0 ;;
  start) ;;
  *) echo "usage: $0 [start|background|wait]" >&2; exit 2 ;;
esac

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
echo SETUP_OK
