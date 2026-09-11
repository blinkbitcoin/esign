#!/usr/bin/env bash
# The web demo against real DocuSign, in one command: the .env, a public URL
# for Connect webhooks, the service on the DocuSign provider, the web demo -
# then it waits so you can run docs/integration/docusign-proxy.md section 5
# in a browser (the return-URL events and the webhook rows), and tears
# everything down on Ctrl-C. Logs: $RUNNER_TEMP or /tmp (esign-live.log for
# the service, every webhook outcome included; web-live.log for Vite).
#   make live-web [VITE_ESIGN_MODE=proxy|webform|publicurl] [LIVE_PUBLIC_URL=https://...]
# The automated counterpart is live.sh (make e2e-live).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/live-service.sh
. scripts/e2e/live-service.sh
live_env
trap live_stack_down EXIT
trap 'exit 130' INT TERM # the EXIT trap tears down once
live_public_url
# The demo calls the service from the browser (CORS); DocuSign redirects the
# signing frame to the return URL, public when a funnel is up
live_service_up CORS_ALLOWED_ORIGINS="http://localhost:$ESIGN_WEB_PORT" \
  DOCUSIGN_RETURN_URL="${PUBLIC_BASE_URL:-http://localhost:$LIVE_PORT}/signing/return"

MODE="${VITE_ESIGN_MODE:-proxy}"
echo "== web demo on :$ESIGN_WEB_PORT ($MODE mode, service :$LIVE_PORT)"
VITE_API_ORIGIN="http://localhost:$LIVE_PORT" VITE_ESIGN_MODE="$MODE" VITE_ESIGN_PREFILL="$E2E_LIVE_PREFILL" \
  npm run web > "${RUNNER_TEMP:-/tmp}/web-live.log" 2>&1 &
wait_for web 40 2 "${RUNNER_TEMP:-/tmp}/web-live.log" http_ok "http://localhost:$ESIGN_WEB_PORT/"
echo
echo "open  http://localhost:$ESIGN_WEB_PORT   (docs/integration/docusign-proxy.md, section 5)"
echo "logs  $LOG (return-URL events, webhook outcomes)  ${RUNNER_TEMP:-/tmp}/web-live.log"
echo "Ctrl-C tears it down (the funnel stays: tailscale funnel --https=443 off)"
wait
