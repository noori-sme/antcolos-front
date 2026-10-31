#!/usr/bin/env bash
# Bring dependencies up to date, cheaply. Safe to run any number of times.
# Runs from: the SessionStart hook, the cloud environment setup script, and by hand
# (`bash .claude/hooks/bootstrap.sh`) in sessions where hooks don't load.
# npm ci only when package-lock.json changed since the last install.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

stamp=node_modules/.agent-bootstrap
hash() { sha256sum "$1" | cut -d' ' -f1; }

if [ "$(cat "$stamp/lock" 2>/dev/null)" != "$(hash package-lock.json)" ]; then
  echo "bootstrap: package-lock.json changed, running npm ci" >&2
  npm ci --no-audit --no-fund --loglevel=error >&2
  mkdir -p "$stamp" && hash package-lock.json > "$stamp/lock"
fi
