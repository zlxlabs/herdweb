#!/usr/bin/env bash
# Update the production deployment: pull latest main, refresh deps, restart.
set -euo pipefail

PROD_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/herdweb"

git -C "$PROD_DIR" pull --ff-only
pnpm --dir "$PROD_DIR" install --frozen-lockfile
systemctl --user restart herdweb.service
printf 'production updated and restarted from %s\n' "$PROD_DIR"
