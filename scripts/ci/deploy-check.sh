#!/usr/bin/env bash
# Validates the deploy templates that ship in the esign-service tarball
# (packages/esign-service/deploy): the Compose file with `docker compose
# config`, and the k8s manifests with kubeconform when it is on PATH (it is
# not installed by the flake, and a missing linter must not fail the build).
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

if command -v kubeconform > /dev/null 2>&1; then
  kubeconform -strict -summary "$DEPLOY"/k8s/*.yaml
  echo "deploy check: k8s manifests are valid"
else
  echo "deploy check: kubeconform not on PATH, skipping the k8s manifests"
fi
