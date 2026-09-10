#!/usr/bin/env bash
# Validates the deploy templates operators copy: the Compose file parses, the
# Cloudflare template actually bundles, and the k8s manifests are schema-valid.
#
# The Worker dry-run is the only real evidence that the Worker bundle excludes
# `pg` and Apollo - the guard test in packages/esign-service reads TypeScript
# source, which cannot see what a bundler would pull in. So it must run in CI,
# not just on a laptop that happens to have wrangler installed: when wrangler
# is not on PATH this shells out to `npx --yes wrangler@$WRANGLER_MAJOR`, and
# only an npx that cannot fetch it (offline) is a skip. It bundles the
# template itself (deploy/cloudflare, whose entry re-exports
# @blinkbitcoin/esign-service/cloudflare), so it needs the service's dist:
# run `npm run build` first. CI: E2E / Build Packages, right after the build.
# Local: make deploy-check.
#
# The bundle runs on a THROWAWAY COPY of the template: wrangler writes a
# `.wrangler/` working directory next to the config it was given, and the
# template is a tracked directory that ships inside the published tarball -
# a check must not leave anything in it. The copy gets a node_modules symlink
# so the entry's `@blinkbitcoin/esign-service/cloudflare` still resolves to
# the workspace, and the template dir is asserted untouched afterwards.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEPLOY=packages/esign-service/deploy

# Pinned major: a wrangler 5 with a different bundler is a change to make on
# purpose, not one to pick up silently on the next CI run.
WRANGLER_MAJOR=4

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DEPLOY/docker-compose.yml" "$TMP/docker-compose.yml"
: > "$TMP/.env"
: > "$TMP/docusign.pem"
docker compose -f "$TMP/docker-compose.yml" config --quiet
echo "deploy check: docker-compose.yml is valid"

if command -v wrangler > /dev/null 2>&1; then
  WRANGLER=(wrangler)
else
  WRANGLER=(npx --yes "wrangler@$WRANGLER_MAJOR")
fi

if [ ! -f packages/esign-service/dist/cloudflare.js ]; then
  echo "deploy check: packages/esign-service/dist is missing (run npm run build), skipping the Worker bundle"
elif ! "${WRANGLER[@]}" --version > /dev/null 2>&1; then
  # Only an unavailable wrangler is a skip; a wrangler that runs and fails
  # below is a broken template.
  echo "deploy check: wrangler is unavailable (offline?), skipping the Worker bundle"
else
  cp -R "$DEPLOY/cloudflare" "$TMP/cloudflare"
  ln -s "$PWD/node_modules" "$TMP/cloudflare/node_modules"
  # --config absolute: wrangler resolves a relative one against the nearest
  # package root (packages/esign-service), not against the working directory
  (cd "$TMP/cloudflare" && "${WRANGLER[@]}" deploy --dry-run \
    --config "$TMP/cloudflare/wrangler.toml" --outdir "$TMP/worker")
  echo "deploy check: the Worker bundle builds"
  # The copy is what wrangler may litter in; the shipped template must be
  # exactly what it was before this script ran.
  if [ -e "$DEPLOY/cloudflare/.wrangler" ]; then
    echo "::error::the Worker dry-run wrote $DEPLOY/cloudflare/.wrangler - it must run on a copy"
    exit 1
  fi
  echo "deploy check: the Cloudflare template is untouched"
fi

if command -v kubeconform > /dev/null 2>&1; then
  kubeconform -strict -summary "$DEPLOY"/k8s/*.yaml
  echo "deploy check: k8s manifests are valid"
else
  echo "deploy check: kubeconform not on PATH, skipping the k8s manifests"
fi
