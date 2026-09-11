#!/usr/bin/env bash
# The E2E Postgres (docker-compose.test.yml, tmpfs) on its port from the
# table - ESIGN_TEST_DB_PORT = ESIGN_PORT_BASE + 12, default 4112 - so two
# worktrees or two repos never fight over one database port. The compose
# project is the worktree's directory name (compose's default), so the
# container is per worktree too.
#   scripts/e2e/test-db.sh up               start and wait for it
#   scripts/e2e/test-db.sh down             stop it
#   scripts/e2e/test-db.sh run <cmd...>     run a command with DATABASE_URL
#          pointing at it (the suites and `npm run migrate:test` read
#          .env.test, whose URL is the default; the exported one wins when
#          the base moved)
#   scripts/e2e/test-db.sh run-docker <cmd...>
#          the same for a command that runs a container (the service image
#          smoke): the URL reaches the host as host.docker.internal
# make test-db-up / test-db-down / e2e-backend / e2e-web / docker-smoke wrap this.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/ports-env.sh
. scripts/e2e/ports-env.sh
case "${1:-}" in
  up)
    docker compose -f docker-compose.test.yml up -d --wait
    bash scripts/e2e/db-wait.sh
    ;;
  down)
    docker compose -f docker-compose.test.yml down
    ;;
  run)
    shift
    DATABASE_URL="$ESIGN_TEST_DATABASE_URL" exec "$@"
    ;;
  run-docker)
    shift
    DATABASE_URL="${ESIGN_TEST_DATABASE_URL/localhost/host.docker.internal}" exec "$@"
    ;;
  *)
    echo "usage: $0 up | down | run <cmd...> | run-docker <cmd...>" >&2; exit 2
    ;;
esac
