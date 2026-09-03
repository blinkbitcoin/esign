#!/usr/bin/env bash
# Hardware acceleration for the Android emulator on GitHub-hosted Linux
# runners: KVM is exposed but the device node needs opening up. Also surfaces
# ANDROID_HOME as ANDROID_SDK_DIR for actions/cache paths, which can only
# read workflow-set env.
set -euo pipefail
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
echo "ANDROID_SDK_DIR=${ANDROID_HOME:?ANDROID_HOME not set}" >> "${GITHUB_ENV:-/dev/null}"
