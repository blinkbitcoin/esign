#!/usr/bin/env bash
# Boots the two small server examples and calls their routes for real: the
# mint-only demo's mutation and the serverless demo's mint (+ webhook)
# handlers. Default: the mock provider, no database, no DocuSign (make
# e2e-server-demos; CI: E2E / Server demos). PROVIDER=docusign: the real
# provider with the DOCUSIGN_* values from the environment - both examples
# mint real instances (part of make e2e-live). Ports: MINT_PORT and
# HANDLER_PORT (ESIGN_PORT_BASE + 4 / + 5, default 4104 / 4105; the mock
# pages' origin is ESIGN_API_PORT's - scripts/lib/ports.mjs).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/wait-lib.sh
. scripts/e2e/wait-lib.sh
# shellcheck source=scripts/e2e/ports-env.sh
. scripts/e2e/ports-env.sh
LOG_DIR="${RUNNER_TEMP:-/tmp}"
PROVIDER="${PROVIDER:-mock}"
if [ "$PROVIDER" = docusign ]; then
  : "${DOCUSIGN_INTEGRATION_KEY:?}" "${DOCUSIGN_PRIVATE_KEY:?}" "${DOCUSIGN_WEBFORM_ID:?}"
  URL_PATTERN='"url":"https://[^"]*#instanceToken='
else
  URL_PATTERN="\"url\":\"${MOCK_PAGES_ORIGIN:-http://localhost:$ESIGN_API_PORT}/signing/mock-webform/"
fi
PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

start() { # <workspace> <port>
  ESIGN_PROVIDER="$PROVIDER" PORT="$2" npm run dev -w "examples/$1" > "$LOG_DIR/$1.log" 2>&1 &
  PIDS+=($!)
}
up() { # <name> <url> - the demo answers (2xx, or 4xx from a route that exists)
  wait_for "$1" 30 1 "$LOG_DIR/$1.log" http_answers "$2"
}
expect_match() { # <label> <pattern> <body>
  if printf '%s' "$3" | grep -Eq "$2"; then echo "server demos smoke: $1 ok"; else
    echo "::error::$1: expected /$2/ in: $3"; exit 1; fi
}

start mint-only-demo "$MINT_PORT"
start serverless-handler-demo "$HANDLER_PORT"
up mint-only-demo "http://127.0.0.1:$MINT_PORT/"
up serverless-handler-demo "http://127.0.0.1:$HANDLER_PORT/health"

# mint-only-demo: the mutation computes the amounts and mints onto the mock page
BODY=$(curl -fsS "http://127.0.0.1:$MINT_PORT/" -H 'content-type: application/json' \
  -H 'authorization: Bearer smoke-user' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url instanceId } }"}')
expect_match "mint-only mutation ($PROVIDER)" "$URL_PATTERN" "$BODY"
BODY=$(curl -fsS "http://127.0.0.1:$MINT_PORT/" -H 'content-type: application/json' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url } }"}')
expect_match "mint-only refuses anonymous" '"Unauthenticated"' "$BODY"

# The return-URL bridge the mint-only host serves for its Web Forms
BODY=$(curl -fsS "http://127.0.0.1:$MINT_PORT/signing/return?event=signing_complete")
expect_match "mint-only return bridge" 'signing_complete' "$BODY"

# serverless-handler-demo: the Fetch handlers behind plain Node
BODY=$(curl -fsS -X POST "http://127.0.0.1:$HANDLER_PORT/webform/instance" \
  -H 'content-type: application/json' -H 'authorization: Bearer smoke-user' \
  -d '{"prefill":{"number_of_units":"10","total_subscription_usd":"1000.00"}}')
expect_match "serverless mint ($PROVIDER)" "$URL_PATTERN" "$BODY"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$HANDLER_PORT/webform/instance" \
  -H 'content-type: application/json' -d '{"prefill":{}}')
expect_match "serverless mint refuses anonymous" '^401$' "$CODE"
# The unsigned webhook is accepted by the mock only; DocuSign's adapter
# refuses it (401) - both are the documented behaviour
if [ "$PROVIDER" = docusign ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$HANDLER_PORT/webhook/esign" \
    -H 'content-type: application/json' -d '{"event":"envelope-completed"}')
  expect_match "serverless webhook refuses unsigned" '^401$' "$CODE"
  echo "server demos smoke: all ok ($PROVIDER)"; exit 0
fi
BODY=$(curl -fsS -X POST "http://127.0.0.1:$HANDLER_PORT/webhook/esign" \
  -H 'content-type: application/json' \
  -d '{"event":"envelope-completed","data":{"envelopeId":"smoke-1","envelopeSummary":{"status":"completed"}}}')
expect_match "serverless webhook" '"received":true' "$BODY"
echo "server demos smoke: all ok"
