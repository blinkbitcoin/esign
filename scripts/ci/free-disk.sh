#!/usr/bin/env bash
# GitHub-hosted ubuntu runner: ~14GB free is not enough for node_modules +
# the Android system image + Docker ("Your device does not have enough disk
# space to run avd"). Drops preinstalled toolchains we never use.
set -euo pipefail
sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/.ghcup /usr/local/share/boost
sudo rm -rf "${AGENT_TOOLSDIRECTORY:-/opt/hostedtoolcache}/CodeQL"
sudo docker image prune -af
df -h /
