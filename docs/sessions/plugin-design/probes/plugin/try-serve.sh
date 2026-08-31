#!/usr/bin/env bash
set -eu
exec python3 "__PROBE_ROOT__/serve.py" \
  --state-dir "${HERDR_PLUGIN_STATE_DIR:?}" \
  --port "${HERDWEB_PROBE_PORT:-17682}" \
  --mode pane \
  --hold-secs 8 \
  serve
