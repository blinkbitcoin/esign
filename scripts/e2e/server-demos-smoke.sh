#!/usr/bin/env bash
# Boots the two small server examples with the mock provider and calls
# their routes for real: the mint-only demo's mutation and the serverless
# demo's mint + webhook handlers. No database, no DocuSign. Ports:
# MINT_PORT (4100) and HANDLER_PORT (4200).
#   scripts/e2e/server-demos-smoke.sh        (make e2e-server-demos)
# CI: E2E / Server demos.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOG_DIR="${RUNNER_TEMP:-/tmp}"
MINT_PORT="${MINT_PORT:-4100}"
HANDLER_PORT="${HANDLER_PORT:-4200}"
PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

start() { # <workspace> <port>
  ESIGN_PROVIDER=mock PORT="$2" npm run dev -w "examples/$1" > "$LOG_DIR/$1.log" 2>&1 &
  PIDS+=($!)
}
wait_for() { # <name> <url>
  for _ in $(seq 1 30); do
    if curl -fsS "$2" > /dev/null 2>&1 || curl -s -o /dev/null -w '%{http_code}' "$2" | grep -q '^[24]'; then
      echo "$1 is up"; return 0
    fi
    sleep 1
  done
  echo "::error::$1 did not answer within 30s"; tail -30 "$LOG_DIR/$1.log" || true; exit 1
}
expect_match() { # <label> <pattern> <body>
  if printf '%s' "$3" | grep -Eq "$2"; then echo "server demos smoke: $1 ok"; else
    echo "::error::$1: expected /$2/ in: $3"; exit 1; fi
}

start mint-only-demo "$MINT_PORT"
start serverless-handler-demo "$HANDLER_PORT"
wait_for mint-only-demo "http://127.0.0.1:$MINT_PORT/"
wait_for serverless-handler-demo "http://127.0.0.1:$HANDLER_PORT/health"

# mint-only-demo: the mutation computes the amounts and mints onto the mock page
BODY=$(curl -fsS "http://127.0.0.1:$MINT_PORT/" -H 'content-type: application/json' \
  -H 'authorization: Bearer smoke-user' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url instanceId } }"}')
expect_match "mint-only mutation" '"url":"http://localhost:4000/signing/mock-webform/' "$BODY"
BODY=$(curl -fsS "http://127.0.0.1:$MINT_PORT/" -H 'content-type: application/json' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url } }"}')
expect_match "mint-only refuses anonymous" '"Unauthenticated"' "$BODY"

# serverless-handler-demo: the Fetch handlers behind plain Node
BODY=$(curl -fsS -X POST "http://127.0.0.1:$HANDLER_PORT/webform/instance" \
  -H 'content-type: application/json' -H 'authorization: Bearer smoke-user' \
  -d '{"prefill":{"number_of_units":10,"total_subscription_usd":1000}}')
expect_match "serverless mint" '"url":"http://localhost:4000/signing/mock-webform/' "$BODY"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$HANDLER_PORT/webform/instance" \
  -H 'content-type: application/json' -d '{"prefill":{}}')
expect_match "serverless mint refuses anonymous" '^401$' "$CODE"
BODY=$(curl -fsS -X POST "http://127.0.0.1:$HANDLER_PORT/webhook/esign" \
  -H 'content-type: application/json' \
  -d '{"event":"envelope-completed","data":{"envelopeId":"smoke-1","envelopeSummary":{"status":"completed"}}}')
expect_match "serverless webhook" '"received":true' "$BODY"
echo "server demos smoke: all ok"
