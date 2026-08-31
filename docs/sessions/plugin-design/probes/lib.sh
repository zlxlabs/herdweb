# Shared helpers. shellcheck shell=bash
PROBE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export PROBE_ROOT
export PYTHONUNBUFFERED=1

PLUGIN_ID="probe.runtime"
UNIT_NAME="herdweb-probe-runtime.service"
UNIT_FAIL_NAME="herdweb-probe-fail.service"
UNIT_STALE_NAME="herdweb-probe-stale.service"
SESSION_A="probe-runtime-s1"
SESSION_B="probe-runtime-s2"
PORT_OCCUPY=17681
PORT_LEDGER=17682
PORT_ALT=17683
PORT_SVC=17684
PORT_FAIL=17685

USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
WORKDIR="${HERDWEB_PROBE_WORKDIR:-/tmp/herdweb-probe-runtime}"
EVIDENCE="$WORKDIR/evidence"
SNAP_BEFORE="$WORKDIR/snap-before.txt"
SNAP_AFTER="$WORKDIR/snap-after.txt"

log() { printf -- '[probe] %s\n' "$*" >&2; }

die() { printf -- '[probe] FATAL %s\n' "$*" >&2; exit 1; }

ensure_workdir() {
  mkdir -p "$EVIDENCE" "$WORKDIR/state" "$WORKDIR/plugin" "$WORKDIR/svc" "$WORKDIR/stale-checkout"
}

record() {
  local id="$1"
  shift
  local out="$EVIDENCE/${id}.txt"
  {
    printf -- 'COMMAND: %s\n' "$*"
    printf -- 'CWD: %s\n' "$PWD"
    printf -- '--- OUTPUT ---\n'
  } >"$out"
  set +e
  "$@" >>"$out" 2>&1
  local rc=$?
  set -e
  printf -- '\n--- EXIT %s ---\n' "$rc" >>"$out"
  return "$rc"
}

record_sh() {
  local id="$1"
  local script="$2"
  local out="$EVIDENCE/${id}.txt"
  {
    printf -- 'COMMAND: bash -c %s\n' "$script"
    printf -- '--- OUTPUT ---\n'
  } >"$out"
  set +e
  bash -c "$script" >>"$out" 2>&1
  local rc=$?
  set -e
  printf -- '\n--- EXIT %s ---\n' "$rc" >>"$out"
  return "$rc"
}

snapshot_env() {
  local dest="$1"
  {
    echo "## date"
    date -Is
    echo "## pids herdr/herdweb (cmd)"
    ps -eo pid,lstart,cmd | grep -E '[h]erdr|[h]erdweb' || true
    echo "## listen 7681 / 1768x"
    ss -ltnp 2>/dev/null | grep -E ':7681|:1768' || true
    echo "## herdr sessions"
    herdr session list || true
    echo "## herdr plugins"
    herdr plugin list || true
    echo "## systemd herdweb-probe units"
    systemctl --user list-units --all 'herdweb-probe-*' --no-pager || true
    echo "## unit files"
    ls -l "$USER_UNIT_DIR"/herdweb-probe-* 2>/dev/null || echo "(none)"
  } >"$dest"
}

extract_pids() {
  ps -eo pid,cmd | awk '/[h]erdr --session default/ {print "herdr_default="$1}
    /[h]erdweb/ && /--port 7681/ {print "herdweb_7681="$1}'
}

stop_our_sessions() {
  local s
  for s in "$SESSION_A" "$SESSION_B"; do
    herdr session stop "$s" >/dev/null 2>&1 || true
    herdr session delete "$s" >/dev/null 2>&1 || true
  done
}

disable_our_units() {
  local u
  for u in "$UNIT_NAME" "$UNIT_FAIL_NAME" "$UNIT_STALE_NAME"; do
    systemctl --user disable --now "$u" >/dev/null 2>&1 || true
    rm -f "$USER_UNIT_DIR/$u"
    systemctl --user reset-failed "$u" >/dev/null 2>&1 || true
  done
  systemctl --user daemon-reload >/dev/null 2>&1 || true
}

unlink_our_plugin() {
  herdr plugin unlink "$PLUGIN_ID" >/dev/null 2>&1 || true
  rm -rf "$HOME/.local/state/herdr/plugins/$PLUGIN_ID"
  rm -rf "$HOME/.config/herdr/plugins/config/$PLUGIN_ID"
}

ensure_session() {
  local name="$1"
  if herdr --session "$name" workspace list >/dev/null 2>&1; then
    log "session $name already running"
    return 0
  fi
    log "booting session $name (client may panic: no tty)"
  timeout 3 herdr --session "$name" </dev/null >"$WORKDIR/${name}-boot.log" 2>&1 || true
  sleep 0.4
  herdr --session "$name" workspace list >/dev/null 2>&1 || \
    die "failed to boot session $name"
}

kill_our_helpers() {
  pkill -f "$PROBE_ROOT/serve.py" >/dev/null 2>&1 || true
  pkill -f "python3 -m http.server ${PORT_OCCUPY}" >/dev/null 2>&1 || true
  local p
  for p in "$PORT_OCCUPY" "$PORT_LEDGER" "$PORT_ALT" "$PORT_SVC" "$PORT_FAIL"; do
    fuser -k "${p}/tcp" >/dev/null 2>&1 || true
  done
}

cleanup_all() {
  log "cleanup start"
  kill_our_helpers
  disable_our_units
  unlink_our_plugin
  stop_our_sessions
  rm -rf "$WORKDIR/state" "$WORKDIR/plugin" "$WORKDIR/svc" "$WORKDIR/stale-checkout" \
    "$WORKDIR/ro" "$WORKDIR/missing" "$WORKDIR/tmpfs-sim"
  log "cleanup done"
}
