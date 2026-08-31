#!/usr/bin/env bash
set -eu
out="${HERDR_PLUGIN_STATE_DIR:-/tmp}/dump-env.txt"
{
  echo "session_hint=${HERDR_SOCKET_PATH:-}"
  date -Is
  printenv | grep -E '^HERDR_' | sort
} | tee "$out"
# Also stamp a per-socket copy so two sessions cannot clobber each other.
if [ -n "${HERDR_SOCKET_PATH:-}" ]; then
  stamp=$(printf '%s' "$HERDR_SOCKET_PATH" | tr '/.' '_')
  cp "$out" "${HERDR_PLUGIN_STATE_DIR:-/tmp}/dump-env-${stamp}.txt"
fi
