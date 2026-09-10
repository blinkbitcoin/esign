#!/usr/bin/env bash
# Sourced by the e2e/ci scripts: exports every service's port variable
# (ESIGN_API_PORT, ESIGN_WEB_PORT, MINT_PORT, HANDLER_PORT, LIVE_PORT,
# SMOKE_PORT, ...) resolved from ESIGN_PORT_BASE + the service's offset, a
# variable already set by the caller winning. The table is scripts/lib/ports.mjs.
eval "$(node "$(dirname "${BASH_SOURCE[0]}")/ports.mjs" env)"
