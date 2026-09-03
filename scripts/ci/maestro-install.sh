#!/usr/bin/env bash
# Installs the Maestro CLI (version the E2E suites are proven against) into
# ~/.maestro unless already present (actions/cache restores it), and puts it
# on the job PATH. Keep MAESTRO_VERSION in sync with the cache keys in e2e.yml.
set -euo pipefail
export MAESTRO_VERSION="${MAESTRO_VERSION:-2.6.1}"
if [ ! -x "$HOME/.maestro/bin/maestro" ]; then
  curl -Ls "https://get.maestro.mobile.dev" | bash
fi
echo "$HOME/.maestro/bin" >> "${GITHUB_PATH:-/dev/null}"
"$HOME/.maestro/bin/maestro" --version
