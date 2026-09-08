#!/usr/bin/env bash
# Writes examples/full-service-demo/.env for a live DocuSign run from the
# four GUIDs and a private-key file, quoting the multi-line PEM the way
# dotenv expects (the step that trips people up when pasting by hand).
#   make docusign-env ACCOUNT_ID=… INTEGRATION_KEY=… USER_ID=… TEMPLATE_ID=… \
#        WEBFORM_ID=… [PEM=examples/full-service-demo/.docusign.pem] [FORCE=1]
# The PEM file stays where it is; only its contents are inlined. Refuses to
# overwrite an existing .env unless FORCE=1. Local only, never CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ACCOUNT_ID:?API Account ID}" "${INTEGRATION_KEY:?integration key}" "${USER_ID:?user id}" \
  "${TEMPLATE_ID:?template id}" "${WEBFORM_ID:?web form id}"
PEM="${PEM:-examples/full-service-demo/.docusign.pem}"
OUT="examples/full-service-demo/.env"
[ -f "$PEM" ] || { echo "::error::private key not found: $PEM"; exit 1; }
if [ -f "$OUT" ] && [ -z "${FORCE:-}" ]; then
  echo "$OUT exists - set FORCE=1 to overwrite"; exit 1
fi
{
  echo "# Written by make docusign-env ($(date -u +%Y-%m-%dT%H:%M:%SZ)); local only"
  echo "PORT=${PORT:-4000}"
  echo "DATABASE_URL=${DATABASE_URL:-postgresql://dev:dev@localhost:5432/esign}"
  echo "JWT_SECRET=${JWT_SECRET:-local-dev-secret}"
  echo "ALLOW_INSECURE_DEV=true"
  echo "ESIGN_PROVIDER=docusign"
  echo "DOCUSIGN_HMAC_KEY=${DOCUSIGN_HMAC_KEY:-local-dev-hmac}"
  echo "DOCUSIGN_ACCOUNT_ID=$ACCOUNT_ID"
  echo "DOCUSIGN_INTEGRATION_KEY=$INTEGRATION_KEY"
  echo "DOCUSIGN_USER_ID=$USER_ID"
  echo "DOCUSIGN_TEMPLATE_ID=$TEMPLATE_ID"
  echo "DOCUSIGN_WEBFORM_ID=$WEBFORM_ID"
  echo "DOCUSIGN_WEBFORMS_BASE_URL=${DOCUSIGN_WEBFORMS_BASE_URL:-https://apps-d.docusign.com/api/webforms/v1.1}"
  echo "DOCUSIGN_RETURN_URL=${DOCUSIGN_RETURN_URL:-http://localhost:${PORT:-4000}/signing/return}"
  printf 'DOCUSIGN_PRIVATE_KEY="'
  cat "$PEM"
  echo '"'
} > "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT (private key inlined from $PEM)"
