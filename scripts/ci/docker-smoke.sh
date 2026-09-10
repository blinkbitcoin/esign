#!/usr/bin/env bash
# Boots an image with the mock provider (no database traffic is needed for
# /health) and asserts the health endpoint answers. Usage:
#   scripts/ci/docker-smoke.sh <image> [container-port]     (make docker-smoke builds first)
# container-port defaults to 4100, the esign-service image's own port
# (ESIGN_PORT_BASE + 0, scripts/lib/ports.mjs); the mint-only demo image
# answers on 4104 (+ 4) instead. The extra env below is the esign-service
# image's boot guard - harmless for an image (like the demo) that ignores it.
set -euo pipefail
# shellcheck source=scripts/e2e/ports-env.sh
. "$(dirname "$0")/../e2e/ports-env.sh"
IMAGE="${1:?image name}"
CONTAINER_PORT="${2:-4100}"
NAME="esign-smoke-$$"
# The host side is SMOKE_PORT (ESIGN_PORT_BASE + 9); the image listens on
# its own default (CONTAINER_PORT)
PORT="$SMOKE_PORT"
docker run -d --rm --name "$NAME" -p "$PORT:$CONTAINER_PORT" \
  -e ESIGN_PROVIDER=mock -e ALLOW_INSECURE_DEV=true \
  -e DATABASE_URL=postgresql://smoke:smoke@localhost:5432/smoke \
  "$IMAGE" > /dev/null
trap 'docker stop "$NAME" > /dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "docker smoke: /health ok on $IMAGE"
    exit 0
  fi
  sleep 1
done
echo "::error::the service in $IMAGE did not answer /health within 30s"
docker logs "$NAME" || true
exit 1
