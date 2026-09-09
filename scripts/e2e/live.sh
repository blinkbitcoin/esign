#!/usr/bin/env bash
# The full live run against real DocuSign, in one command: start the service
# on the DocuSign provider (examples/full-service-demo/.env, see make
# docusign-env), run the API live test (JWT grant + real instance mints),
# then the Playwright checks against the capability test form (locked
# fields, then the form submitted and signed inside the web component,
# then a proxy-mode signature; docs/integration/webforms.md), and stop the
# service. Local only. The React Native counterpart is ios-live.sh.
#   make e2e-live [LIVE_PORT=4010]
# Override the fixture defaults with E2E_LIVE_PREFILL / E2E_LIVE_LOCKED_LABELS.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/live-service.sh
. scripts/e2e/live-service.sh
live_env

echo "== docusign check"
npm run --silent docusign:check -w "$SERVICE"

# The Web Forms half of the live suite (the envelope half needs a template
# built for the proxy flow: make test-live)
echo "== api live test (Web Forms)"
npm run --silent "$LIVE_TEST" -w "$SERVICE" -- tests/live/webforms.live.test.ts

# The web demo (webform-live-demo spec) calls the service from the browser:
# allow this worktree's Vite origins
ORIGINS=$(cd examples/react-demo && npx tsx -e "import { MODES, PORTS } from './e2e/ports'; console.log(MODES.map(m => 'http://localhost:' + PORTS.vite[m]).join(','))" | tail -1)
trap live_service_down EXIT
live_service_up CORS_ALLOWED_ORIGINS="$ORIGINS"

echo "== playwright: locked fields on the real form"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:webform:live -w examples/react-demo

echo "== playwright: the real form inside the web component (iframe), submitted and signed"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:webform:live:demo -w examples/react-demo

echo "== playwright: proxy mode - a real signature inside the web component"
E2E_LIVE_API_ORIGIN="http://localhost:$LIVE_PORT" npm run --silent test:e2e:proxy:live:demo -w examples/react-demo

echo "== the mint-only and serverless examples mint real instances"
PROVIDER=docusign MINT_PORT="${MINT_PORT:-4110}" HANDLER_PORT="${HANDLER_PORT:-4210}" bash scripts/e2e/server-demos-smoke.sh
echo "live run: all ok (screenshots in examples/react-demo/test-results/)"
