#!/usr/bin/env bash
# Sourced by the e2e scripts: the one "poll until ready" loop, instead of a
# hand-rolled copy per script. Usage:
#   wait_for <name> <retries> <sleep-seconds> <log-file-or-""> <check command...>
# Runs the check command up to <retries> times, <sleep-seconds> apart, with
# its output discarded; prints "<name> is up" and returns 0 on the first
# success, otherwise "::error::<name> did not answer within Ns" plus the
# tail of the log file (when given) and returns 1.
# Two ready-made checks for HTTP endpoints:
#   http_ok <url>       2xx only (curl -f)
#   http_answers <url>  any 2xx or 4xx (a route that exists but rejects the probe)
wait_for() {
  local name=$1 retries=$2 delay=$3 log=$4 i
  shift 4
  for ((i = 1; i <= retries; i++)); do
    if "$@" > /dev/null 2>&1; then
      echo "$name is up"
      return 0
    fi
    sleep "$delay"
  done
  echo "::error::$name did not answer within $((retries * delay))s"
  if [ -n "$log" ]; then
    tail -30 "$log" 2> /dev/null || true
  fi
  return 1
}

http_ok() { # <url>
  curl -fsS "$1" > /dev/null
}

http_answers() { # <url>
  http_ok "$1" || curl -s -o /dev/null -w '%{http_code}' "$1" | grep -q '^[24]'
}
