#!/usr/bin/env bash
# The dev Postgres (packages/esign-service/docker-compose.yml, a named volume)
# on its port from the table - ESIGN_DEV_DB_PORT = ESIGN_PORT_BASE + 13,
# default 4113 - in a compose project named after this worktree, so every
# worktree has its own container, port and data volume (the package's own
# `docker compose up` would put them all in one project called esign-service).
#   scripts/e2e/dev-db.sh up             start and wait for it
#   scripts/e2e/dev-db.sh down           stop it (the volume stays; `down -v` drops it)
#   scripts/e2e/dev-db.sh run <cmd...>   run a command with DATABASE_URL pointing
#          at it unless the environment (.env via direnv) already set one
# make db-up / db-down / migrate / backend wrap this.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/ports-env.sh
. scripts/e2e/ports-env.sh
COMPOSE=(docker compose -f packages/esign-service/docker-compose.yml -p "$(basename "$PWD")-dev")
case "${1:-}" in
  up)
    "${COMPOSE[@]}" up -d --wait
    ;;
  down)
    shift
    "${COMPOSE[@]}" down "$@"
    ;;
  run)
    shift
    DATABASE_URL="${DATABASE_URL:-$ESIGN_DEV_DATABASE_URL}" exec "$@"
    ;;
  *)
    echo "usage: $0 up | down [-v] | run <cmd...>" >&2; exit 2
    ;;
esac
