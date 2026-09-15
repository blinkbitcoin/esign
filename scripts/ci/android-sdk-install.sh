#!/usr/bin/env bash
# Installs Android SDK packages, retrying a download that lands corrupt.
#
# android-emulator-runner installs the packages it needs itself and has no
# retry, so one bad download takes the whole Android E2E job down before
# Maestro ever runs (run 35001961934: "An error occurred while preparing SDK
# package Android Emulator: Error on ZipFile unknown archive", then adb
# failing to reach an emulator that never started). Pre-installing here makes
# the action's own sdkmanager call a no-op - it skips a package already at
# the current revision, the same property the system-image cache in e2e.yml
# relies on - so a corrupt archive costs a retry instead of the job.
#
# Usage: android-sdk-install.sh <sdk-package>... (ANDROID_SDK_RETRIES: 2)
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: $0 <sdk-package>..." >&2; exit 2; }

retries="${ANDROID_SDK_RETRIES:-2}"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$sdk_root" ] || { echo "neither ANDROID_HOME nor ANDROID_SDK_ROOT is set" >&2; exit 1; }

attempt=0
while :; do
  # --channel=0 (stable) is what the action asks for, so the revision resolved
  # here is the one it then finds installed. stdin is closed so an unaccepted
  # license fails instead of waiting for a prompt that will never come; stdout
  # is dropped (progress bars only) and stderr kept - that is where sdkmanager
  # reports the archive it could not read.
  if sdkmanager --install "$@" --channel=0 </dev/null >/dev/null; then
    echo "Installed: $*"
    exit 0
  fi

  if [ "$attempt" -ge "$retries" ]; then
    echo "sdkmanager could not install '$*' in $((attempt + 1)) attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))

  # The half-written archive is cached and replayed, so every later attempt
  # fails the same way until the cache is gone.
  rm -rf "$sdk_root/.downloadIntermediates" "$HOME/.android/cache"
  echo "sdkmanager failed; purged the download cache, retry $attempt of $retries" >&2
done
