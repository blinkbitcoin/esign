#!/usr/bin/env bash
# The full live run against real DocuSign, in one command: start the service
# on the DocuSign provider (examples/full-service-demo/.env, see make
# docusign-env), run the API live test (JWT grant + real instance mints),
# then the Playwright locked-fields check against the capability test form
# (docs/integration/webforms.md), and stop the service. Local only.
#   make e2e-live [LIVE_PORT=4010]
# Override the fixture defaults with E2E_LIVE_PREFILL / E2E_LIVE_LOCKED_LABELS.
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVICE=examples/full-service-demo
[ -f "$SERVICE/.env" ] || { echo "::error::$SERVICE/.env missing - run make docusign-env first"; exit 1; }
LIVE_PORT="${LIVE_PORT:-4010}"
LOG="${RUNNER_TEMP:-/tmp}/esign-live.log"

# The fixture form's locked terms (group C) plus the signer fields it requires
PREFILL_DEFAULT='{"full_name":"Test User","email":"test@example.com","newsletter":"yes","reference":"E2E-0001","plan":"seed","number_of_units":1000,"total_subscription_usd":1000,"settlement_amount_btc":0.01,"btc_usd_rate":78850,"rate_timestamp":"2026-09-08 10:44","settlement_date":"2026-09-10","phone":"+1 555 123 4567"}'
LABELS_DEFAULT='{"Registration Reference":"E2E-0001","Number of Units":"1000","Total Subscription (USD)":"1000","Settlement Amount (BTC)":"0.01","BTC/USD Conversion Rate":"78850","Rate Timestamp":"2026-09-08 10:44"}'
export E2E_LIVE_PREFILL="${E2E_LIVE_PREFILL:-$PREFILL_DEFAULT}"
export E2E_LIVE_LOCKED_LABELS="${E2E_LIVE_LOCKED_LABELS:-$LABELS_DEFAULT}"
export DOCUSIGN_LIVE_PREFILL="${DOCUSIGN_LIVE_PREFILL:-$E2E_LIVE_PREFILL}"

echo "== docusign check"
npm run --silent docusign:check -w "$SERVICE"

echo "== api live test"
npm run --silent test:live -w "$SERVICE"

echo "== service on :$LIVE_PORT (DocuSign provider)"
( cd "$SERVICE" && PORT="$LIVE_PORT" DOCUSIGN_RETURN_URL="http://localhost:$LIVE_PORT/signing/return" npm run dev > "$LOG" 2>&1 ) &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$LIVE_PORT/health" > /dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$LIVE_PORT/health" > /dev/null || { echo "::error::service did not start"; tail -30 "$LOG"; exit 1; }

echo "== playwright: locked fields on the real form"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:webform:live -w examples/react-demo
echo "live run: all ok (screenshot: examples/react-demo/test-results/webform-live.png)"
