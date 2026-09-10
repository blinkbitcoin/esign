#!/usr/bin/env bash
# Sourced by live.sh (web) and ios-live.sh (React Native): the DocuSign
# credentials, the fixture form's prefill, and the service on the DocuSign
# provider. Defines:
#   live_env            load packages/esign-service/.env or the DOCUSIGN_* env
#                       (sets LIVE_TEST, SERVICE, LIVE_PORT, E2E_LIVE_PREFILL, ...)
#   live_service_up     E2E Postgres + migrations + the service on $LIVE_PORT
#   live_service_down   stop the service and the database (trap it on EXIT)
# Local only; the CI variant is docs/operations/live-e2e-ci.md.
SERVICE=packages/esign-service
# shellcheck source=scripts/e2e/wait-lib.sh
. scripts/e2e/wait-lib.sh
# shellcheck source=scripts/e2e/ports-env.sh
. scripts/e2e/ports-env.sh

live_env() {
  # Two ways in: a local .env (make docusign-env), or the DocuSign values in
  # the environment (CI: docs/operations/live-e2e-ci.md). In the second case
  # the non-secret service settings get local-dev defaults here.
  # shellcheck disable=SC2034  # LIVE_TEST is the caller's (live.sh)
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
  # LIVE_PORT: ESIGN_PORT_BASE + 6 (default 4106) unless set (ports-env.sh)
  LOG="${RUNNER_TEMP:-/tmp}/esign-live.log"

  # The fixture form's locked terms (group C) plus every required editable
  # field (the form refuses Next while one is empty, so the walker could not
  # reach the locked pages otherwise). The amounts are strings: the form types
  # them as Text, and its Date field is editable (a read-only Number or Date
  # field makes DocuSign refuse the submission - docs/integration/webforms.md)
  PREFILL_DEFAULT='{"Signer_name":"Test User","Signer_email":"test@example.com","full_name":"Test User","email":"test@example.com","country":"Sweden","newsletter":"yes","reference":"E2E-0001","plan":"seed","number_of_units":"1000","total_subscription_usd":"1000","settlement_amount_btc":"0.01268231","btc_usd_rate":"78850","rate_timestamp":"2026-09-08 10:44","settlement_date":"2026-09-10","phone":"+1 555 123 4567"}'
  LABELS_DEFAULT='{"Registration Reference":"E2E-0001","Number of Units":"1000","Total Subscription (USD)":"1000","Settlement Amount (BTC)":"0.01268231","BTC/USD Conversion Rate":"78850","Rate Timestamp":"2026-09-08 10:44"}'
  export E2E_LIVE_PREFILL="${E2E_LIVE_PREFILL:-$PREFILL_DEFAULT}"
  export E2E_LIVE_LOCKED_LABELS="${E2E_LIVE_LOCKED_LABELS:-$LABELS_DEFAULT}"
  export DOCUSIGN_LIVE_PREFILL="${DOCUSIGN_LIVE_PREFILL:-$E2E_LIVE_PREFILL}"
}

# shellcheck disable=SC2120  # the extra env is optional (ios-live.sh passes none)
live_service_up() { # [extra env for the service, e.g. CORS_ALLOWED_ORIGINS=...]
  # The journeys persist envelopes: the E2E Postgres (tmpfs, :5433)
  echo "== test database"
  make test-db-up > /dev/null
  export DATABASE_URL="postgresql://test:test@localhost:5433/esign_test"
  npm run --silent migrate -w "$SERVICE" > /dev/null

  echo "== service on :$LIVE_PORT (DocuSign provider)"
  # Never adopt a listener already on the port (a stale run, a foreign server)
  if lsof -t -iTCP:"$LIVE_PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "::error::port $LIVE_PORT is taken - stop that process or set LIVE_PORT"; exit 1
  fi
  ( cd "$SERVICE" && env "$@" PORT="$LIVE_PORT" DOCUSIGN_RETURN_URL="http://localhost:$LIVE_PORT/signing/return" npm run dev > "$LOG" 2>&1 ) &
  SERVICE_PID=$!
  wait_for "service" 30 1 "$LOG" http_ok "http://127.0.0.1:$LIVE_PORT/health"
}

# npm wraps tsx wraps node: stop the process that actually listens, then the wrapper
live_service_down() {
  lsof -t -iTCP:"$LIVE_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  kill "${SERVICE_PID:-}" 2>/dev/null || true
  make test-db-down > /dev/null 2>&1 || true
}
