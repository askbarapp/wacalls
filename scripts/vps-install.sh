#!/usr/bin/env bash
# One-line VPS bootstrap: clone WaCalls and run the full installer.
# Usage (as root on Ubuntu 22.04 / 24.04):
#   curl -fsSL https://raw.githubusercontent.com/REPO_OWNER/wacalls/main/scripts/vps-install.sh | sudo bash
set -euo pipefail

REPO_URL="${WACALLS_REPO:-https://github.com/REPO_OWNER/wacalls.git}"
BRANCH="${WACALLS_BRANCH:-main}"
APP_DIR="${WACALLS_DIR:-/opt/wacalls}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: curl -fsSL ... | sudo bash"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git ca-certificates curl

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}"
fi

chmod +x "${APP_DIR}/setup.sh" "${APP_DIR}/scripts/"*.sh
exec "${APP_DIR}/scripts/setup.sh"
