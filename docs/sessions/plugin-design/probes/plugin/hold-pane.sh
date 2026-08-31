#!/usr/bin/env bash
set -eu
out="${HERDR_PLUGIN_STATE_DIR:-/tmp}/pane-env.txt"
{
  date -Is
  printenv | grep -E '^HERDR_' | sort
} | tee "$out"
sleep 20
