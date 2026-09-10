#!/usr/bin/env bash
# Boots an image with the mock provider and asserts the capabilities it should
# have. Usage:
#   scripts/ci/docker-smoke.sh <image> [container-port]     (make docker-smoke builds first)
#
# Two modes, both of which the esign-service image must pass:
#   mint only  - no DATABASE_URL: /health reports ["mint"] and the envelope
#                webhook route is absent (404)
#   full       - DATABASE_URL set: /health reports envelopes too and the
#                webhook route answers
# The mode is the presence of DATABASE_URL in this script's own environment.
#
# container-port defaults to 4100, the esign-service image's own port
# (ESIGN_PORT_BASE + 0, scripts/lib/ports.mjs); the mint-only demo image
# answers on 4104 (+ 4) instead and ignores the rest of the environment below.
set -euo pipefail
# shellcheck source=scripts/e2e/ports-env.sh
. "$(dirname "$0")/../e2e/ports-env.sh"
IMAGE="${1:?image name}"
CONTAINER_PORT="${2:-4100}"
NAME="esign-smoke-$$"
# The host side is SMOKE_PORT (ESIGN_PORT_BASE + 9); the image listens on
# its own default (CONTAINER_PORT)
PORT="$SMOKE_PORT"
MODE="mint only"
ENV_ARGS=(-e ESIGN_PROVIDER=mock -e ALLOW_INSECURE_DEV=true)
if [ -n "${DATABASE_URL:-}" ]; then
  MODE="full"
  ENV_ARGS+=(-e "DATABASE_URL=$DATABASE_URL")
fi

docker run -d --rm --name "$NAME" --add-host host.docker.internal:host-gateway \
  -p "$PORT:$CONTAINER_PORT" "${ENV_ARGS[@]}" "$IMAGE" > /dev/null
trap 'docker stop "$NAME" > /dev/null 2>&1 || true' EXIT

HEALTH=""
for _ in $(seq 1 30); do
  if HEALTH=$(curl -fsS "http://127.0.0.1:$PORT/health" 2> /dev/null); then
    break
  fi
  HEALTH=""
  sleep 1
done
if [ -z "$HEALTH" ]; then
  echo "::error::the service in $IMAGE did not answer /health within 30s ($MODE)"
  docker logs "$NAME" || true
  exit 1
fi
echo "docker smoke ($MODE): /health ok on $IMAGE - $HEALTH"

# Only the esign-service image reports capabilities and serves the webhook
# route; another image (the mint-only demo) is done once /health answers.
if ! printf '%s' "$HEALTH" | grep -q '"capabilities"'; then
  exit 0
fi

WEBHOOK=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$PORT/webhook/esign" -H 'content-type: application/json' \
  -d '{"event":"envelope-completed"}')

if [ "$MODE" = "full" ]; then
  if ! printf '%s' "$HEALTH" | grep -q '"envelopes"'; then
    echo "::error::DATABASE_URL is set but /health does not report the envelopes capability: $HEALTH"
    docker logs "$NAME" || true
    exit 1
  fi
  # The route exists: an unsigned, incomplete payload is refused (400), never 404
  if [ "$WEBHOOK" = "404" ]; then
    echo "::error::the envelope webhook route is absent with DATABASE_URL set"
    docker logs "$NAME" || true
    exit 1
  fi
  echo "docker smoke (full): the envelope webhook answers ($WEBHOOK)"
  exit 0
fi

if printf '%s' "$HEALTH" | grep -q '"envelopes"'; then
  echo "::error::no DATABASE_URL, but /health reports the envelopes capability: $HEALTH"
  exit 1
fi
if [ "$WEBHOOK" != "404" ]; then
  echo "::error::the envelope webhook route answered $WEBHOOK without DATABASE_URL (expected 404)"
  docker logs "$NAME" || true
  exit 1
fi
echo "docker smoke (mint only): the envelope webhook is absent (404)"
