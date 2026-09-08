#!/usr/bin/env bash
# Boots the service image with the mock provider (no database traffic is
# needed for /health) and asserts the health endpoint answers. Usage:
#   scripts/ci/docker-smoke.sh <image>        (make docker-smoke builds first)
set -euo pipefail
IMAGE="${1:?image name}"
NAME="esign-smoke-$$"
PORT="${SMOKE_PORT:-4321}"
docker run -d --rm --name "$NAME" -p "$PORT:4000" \
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
