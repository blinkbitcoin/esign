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

# Two ways in: a local .env (make docusign-env), or the DocuSign values in
# the environment (CI: docs/operations/live-e2e-ci.md). In the second case
# the non-secret service settings get local-dev defaults here.
if [ -f "$SERVICE/.env" ]; then
  LIVE_TEST="test:live"
  # The small examples read the environment, not the service's .env
  set -a
  # shellcheck disable=SC1091
  . "$SERVICE/.env"
  set +a
elif [ -n "${DOCUSIGN_INTEGRATION_KEY:-}" ]; then
  : "${DOCUSIGN_USER_ID:?}" "${DOCUSIGN_ACCOUNT_ID:?}" "${DOCUSIGN_PRIVATE_KEY:?}" \
    "${DOCUSIGN_TEMPLATE_ID:?}" "${DOCUSIGN_WEBFORM_ID:?}"
  export ESIGN_PROVIDER=docusign ALLOW_INSECURE_DEV=true
  export DATABASE_URL="${DATABASE_URL:-postgresql://live:live@localhost:5432/live}"
  export DOCUSIGN_HMAC_KEY="${DOCUSIGN_HMAC_KEY:-live-e2e-hmac}"
  export DOCUSIGN_WEBFORMS_BASE_URL="${DOCUSIGN_WEBFORMS_BASE_URL:-https://apps-d.docusign.com/api/webforms/v1.1}"
  unset JWT_SECRET # the bearer token is the user id (what the specs send)
  LIVE_TEST="test:live:env"
else
  echo "::error::no $SERVICE/.env (make docusign-env) and no DOCUSIGN_* in the environment"; exit 1
fi
LIVE_PORT="${LIVE_PORT:-4010}"
LOG="${RUNNER_TEMP:-/tmp}/esign-live.log"

# The fixture form's locked terms (group C) plus every required editable
# field (the form refuses Next while one is empty, so the walker could not
# reach the locked pages otherwise)
PREFILL_DEFAULT='{"Signer_name":"Test User","Signer_email":"test@example.com","full_name":"Test User","email":"test@example.com","country":"Sweden","newsletter":"yes","reference":"E2E-0001","plan":"seed","number_of_units":1000,"total_subscription_usd":1000,"settlement_amount_btc":0.01,"btc_usd_rate":78850,"rate_timestamp":"2026-09-08 10:44","settlement_date":"2026-09-10","phone":"+1 555 123 4567"}'
LABELS_DEFAULT='{"Registration Reference":"E2E-0001","Number of Units":"1000","Total Subscription (USD)":"1000","Settlement Amount (BTC)":"0.01","BTC/USD Conversion Rate":"78850","Rate Timestamp":"2026-09-08 10:44"}'
export E2E_LIVE_PREFILL="${E2E_LIVE_PREFILL:-$PREFILL_DEFAULT}"
export E2E_LIVE_LOCKED_LABELS="${E2E_LIVE_LOCKED_LABELS:-$LABELS_DEFAULT}"
export DOCUSIGN_LIVE_PREFILL="${DOCUSIGN_LIVE_PREFILL:-$E2E_LIVE_PREFILL}"

echo "== docusign check"
npm run --silent docusign:check -w "$SERVICE"

# The Web Forms half of the live suite (the envelope half needs a template
# built for the proxy flow: make test-live)
echo "== api live test (Web Forms)"
npm run --silent "$LIVE_TEST" -w "$SERVICE" -- tests/live/webforms.live.test.ts

# The proxy journey persists envelopes: the E2E Postgres (tmpfs, :5433)
echo "== test database"
make test-db-up > /dev/null
export DATABASE_URL="postgresql://test:test@localhost:5433/esign_test"
npm run --silent migrate -w "$SERVICE" > /dev/null

echo "== service on :$LIVE_PORT (DocuSign provider)"
# Never adopt a listener already on the port (a stale run, a foreign server)
if lsof -t -iTCP:"$LIVE_PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  echo "::error::port $LIVE_PORT is taken - stop that process or set LIVE_PORT"; exit 1
fi
# The web demo (webform-live-demo spec) calls the service from the browser:
# allow this worktree's Vite origins
ORIGINS=$(cd examples/react-demo && npx tsx -e "import { MODES, PORTS } from './e2e/ports'; console.log(MODES.map(m => 'http://localhost:' + PORTS.vite[m]).join(','))" | tail -1)
( cd "$SERVICE" && PORT="$LIVE_PORT" CORS_ALLOWED_ORIGINS="$ORIGINS" DOCUSIGN_RETURN_URL="http://localhost:$LIVE_PORT/signing/return" npm run dev > "$LOG" 2>&1 ) &
PID=$!
# npm wraps tsx wraps node: stop the process that actually listens, then the wrapper
stop_service() {
  lsof -t -iTCP:"$LIVE_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  kill "$PID" 2>/dev/null || true
  make test-db-down > /dev/null 2>&1 || true
}
trap stop_service EXIT
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$LIVE_PORT/health" > /dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$LIVE_PORT/health" > /dev/null || { echo "::error::service did not start"; tail -30 "$LOG"; exit 1; }

echo "== playwright: locked fields on the real form"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:webform:live -w examples/react-demo

echo "== playwright: the real form inside the web component (iframe)"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:webform:live:demo -w examples/react-demo

echo "== playwright: proxy mode - a real signature inside the web component"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:proxy:live:demo -w examples/react-demo

echo "== the mint-only and serverless examples mint real instances"
PROVIDER=docusign MINT_PORT="${MINT_PORT:-4110}" HANDLER_PORT="${HANDLER_PORT:-4210}" bash scripts/e2e/server-demos-smoke.sh
echo "live run: all ok (screenshots in examples/react-demo/test-results/)"
echo "KNOWN LIMITATION: DocuSign (demo env) refuses to complete a Web Form with read-only fields (422);"
echo "  the 'submission completes' spec is an expected failure and turns red when that changes."
