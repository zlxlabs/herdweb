#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"
command -v herdr >/dev/null
node -e "require('node-pty')"
command -v python3 >/dev/null
command -v script >/dev/null
command -v timeout >/dev/null

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
SESSION="keyprobe-$RUN_ID"
RESULT_DIR="$SCRIPT_DIR/results/$RUN_ID"
TMP_DIR="$(mktemp -d)"
SERVER_PID=''
SESSION_CREATED=0
mkdir -p "$RESULT_DIR"

cleanup() {
  local rc=$?
  local cleanup_failed=0
  trap - EXIT INT TERM
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    if herdr --session "$SESSION" server stop; then
      if wait "$SERVER_PID"; then printf 'server_pid=%s reaped=yes\n' "$SERVER_PID"; else cleanup_failed=1; printf 'server_pid=%s reaped=no\n' "$SERVER_PID"; fi
    else
      cleanup_failed=1
      if kill "$SERVER_PID" 2>/dev/null; then
        if wait "$SERVER_PID"; then printf 'server_pid=%s reaped=forced-after-stop-error\n' "$SERVER_PID"; else cleanup_failed=1; printf 'server_pid=%s reaped=no-after-stop-error\n' "$SERVER_PID"; fi
      else
        printf 'server_pid=%s reaped=no-after-stop-error\n' "$SERVER_PID"
      fi
    fi
  elif [[ -n "$SERVER_PID" ]]; then
    wait "$SERVER_PID" || cleanup_failed=1
    printf 'server_pid=%s reaped=yes\n' "$SERVER_PID"
  fi
  if (( SESSION_CREATED )); then
    if [[ -d "$HOME/.config/herdr/sessions/$SESSION" ]]; then
      if ! herdr --session "$SESSION" session delete --json "$SESSION"; then cleanup_failed=1; fi
    fi
    if herdr --session "$SESSION" session list > "$TMP_DIR/session-list.txt"; then
      if rg -q "^${SESSION}[[:space:]]" "$TMP_DIR/session-list.txt"; then cleanup_failed=1; fi
      if ! rg -q '^default[[:space:]]+running[[:space:]]' "$TMP_DIR/session-list.txt"; then cleanup_failed=1; fi
      printf 'created_session=%s\ndestroyed_session=%s\nfinal_herdr_session_list:\n' "$SESSION" "$SESSION"
      cat "$TMP_DIR/session-list.txt"
    else
      cleanup_failed=1
    fi
  fi
  rm -rf -- "$TMP_DIR"
  if (( rc == 0 && cleanup_failed )); then rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

herdr --session "$SESSION" --version
SESSION_CREATED=1
herdr --session "$SESSION" server >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in {1..100}; do
  if rg -q '^herdr server running;' "$TMP_DIR/server.log"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$TMP_DIR/server.log"; exit 1; fi
  sleep 0.05
done
if ! rg -q '^herdr server running;' "$TMP_DIR/server.log"; then cat "$TMP_DIR/server.log"; exit 1; fi
herdr --session "$SESSION" status server >"$TMP_DIR/server-status.txt"
rg -q "socket: $HOME/.config/herdr/sessions/$SESSION/herdr.sock" "$TMP_DIR/server-status.txt"
CREATE_JSON="$(herdr --session "$SESSION" workspace create --cwd "$TMP_DIR" --label "$SESSION" --no-focus)"
PANE_ID="$(printf '%s' "$CREATE_JSON" | node -e "let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).result.root_pane.pane_id))")"
PREFIX="$(python3 -c 'import pathlib,tomllib; p=pathlib.Path.home()/".config/herdr/config.toml"; d=tomllib.loads(p.read_text()) if p.exists() else {}; print(d.get("keys",{}).get("prefix","ctrl+b"))')"
printf 'herdr_session=%s\npane=%s\nprefix=%s\nresult_dir=%s\n' "$SESSION" "$PANE_ID" "$PREFIX" "$RESULT_DIR"
node "$SCRIPT_DIR/driver.mjs" "$SESSION" "$PANE_ID" "$RESULT_DIR" "$TMP_DIR" "$SCRIPT_DIR/reader.mjs" "$REPO_ROOT" "$PREFIX"
