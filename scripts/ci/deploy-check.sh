#!/usr/bin/env bash
# Validates the deploy templates that ship in the esign-service tarball
# (packages/esign-service/deploy): the Compose file with `docker compose
# config`, the k8s manifests with kubeconform, and the Worker template with
# `wrangler deploy --dry-run` - which is also the one check that proves a
# bundler following the Cloudflare entry never pulls in pg or Apollo. The
# last two run only when the tool is on PATH (neither is installed by the
# flake, and a missing linter must not fail the build).
#   scripts/ci/deploy-check.sh              (make deploy-check; CI: E2E / Docker)
set -euo pipefail
cd "$(dirname "$0")/../.."
DEPLOY=packages/esign-service/deploy

# The template mounts a PEM as a Compose secret and reads .env; neither exists
# in a checkout, so give `config` a throwaway pair in a temp dir.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DEPLOY/docker-compose.yml" "$TMP/docker-compose.yml"
: > "$TMP/.env"
: > "$TMP/docusign.pem"
docker compose -f "$TMP/docker-compose.yml" config --quiet
echo "deploy check: docker-compose.yml is valid"

if command -v wrangler > /dev/null 2>&1; then
  # The template imports the published package; in this repo the built
  # entry is what a bundler would see, so point wrangler at it.
  wrangler deploy --dry-run --outdir "$TMP/worker" \
    --compatibility-flags nodejs_compat \
    --name esign-service-dry-run \
    packages/esign-service/dist/cloudflare.js
  echo "deploy check: the Worker bundle builds"
else
  echo "deploy check: wrangler not on PATH, skipping the Worker bundle"
fi

if command -v kubeconform > /dev/null 2>&1; then
  kubeconform -strict -summary "$DEPLOY"/k8s/*.yaml
  echo "deploy check: k8s manifests are valid"
else
  echo "deploy check: kubeconform not on PATH, skipping the k8s manifests"
fi
