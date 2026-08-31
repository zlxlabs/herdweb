#!/usr/bin/env bash
# Binds 127.0.0.1 only; ports 17681+; plugin id probe.*; units herdweb-probe-*.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh
SERVE=(python3 "$PROBE_ROOT/serve.py")

install_plugin() {
  rm -rf "$WORKDIR/plugin"; mkdir -p "$WORKDIR/plugin"
  cp "$PROBE_ROOT/plugin/"* "$WORKDIR/plugin/"
  sed -i "s|__PROBE_ROOT__|$PROBE_ROOT|g" "$WORKDIR/plugin/try-serve.sh"
  chmod +x "$WORKDIR/plugin/"*.sh
  herdr plugin unlink "$PLUGIN_ID" >/dev/null 2>&1 || true
  record D12-link herdr plugin link "$WORKDIR/plugin" || true
}

write_unit() {
  cat >"$USER_UNIT_DIR/$1" <<EOF
[Unit]
Description=herdweb probe
[Service]
Type=simple
WorkingDirectory=$WORKDIR/svc
Environment=HERDR_PLUGIN_CONFIG_DIR=$WORKDIR/svc/config
Environment=HERDR_PLUGIN_STATE_DIR=$WORKDIR/state/svc
Environment=HERDR_PLUGIN_ROOT=$WORKDIR/svc
Environment=HERDR_PLUGIN_ID=$PLUGIN_ID
Environment=HERDWEB_PROBE_PORT=$PORT_SVC
ExecStart=$2
$3
[Install]
WantedBy=default.target
EOF
}

probe_a() {
  log "A flock ledger"
  local sd="$WORKDIR/state/a"; mkdir -p "$sd"
  record_sh A1 "
    lock='$sd/herdweb.lock'; : > \"\$lock\"
    flock -n -E 42 \"\$lock\" -c 'sleep 4' & holder=\$!; sleep 0.2
    flock -n -E 42 \"\$lock\" -c 'echo unexpected-acquired'; echo second_exit=\$?
    wait \$holder; echo holder_exit=\$?
  " || true
  "${SERVE[@]}" --state-dir "$sd" --port "$PORT_LEDGER" --hold-secs 30 serve \
    >"$EVIDENCE/A2-holder.out" 2>&1 &
  local hp=$!; sleep 0.4
  "${SERVE[@]}" --state-dir "$sd" diagnose >"$EVIDENCE/A2-live.json" 2>&1 || true
  kill -KILL "$hp" 2>/dev/null || true; wait "$hp" 2>/dev/null || true; sleep 0.2
  {
    echo "COMMAND: SIGKILL pid=$hp then try-lock + diagnose"
    echo "owner.json:"; cat "$sd/herdweb.owner.json" 2>/dev/null || echo missing
    echo "proc? $(test -d /proc/$hp && echo yes || echo no)"
    echo -n "try-lock: "; "${SERVE[@]}" --state-dir "$sd" try-lock
    echo "diagnose:"; "${SERVE[@]}" --state-dir "$sd" diagnose
  } >"$EVIDENCE/A2.txt" 2>&1 || true
  record_sh A3-missing "python3 -c \"
import os
p='/tmp/does-not-exist-herdweb-probe/herdweb.lock'
try: open(p,'a+'); print('unexpected')
except OSError as e: print('missing_dir', type(e).__name__, e)
\"" || true
  mkdir -p "$WORKDIR/ro"; : >"$WORKDIR/ro/herdweb.lock"
  chmod a-w "$WORKDIR/ro" "$WORKDIR/ro/herdweb.lock"
  record_sh A3-readonly "flock -n -E 42 '$WORKDIR/ro/herdweb.lock' -c 'echo acquired'; echo exit=\$?" || true
  chmod u+w "$WORKDIR/ro" "$WORKDIR/ro/herdweb.lock" || true
  mkdir -p "$WORKDIR/ro-dir"; chmod 555 "$WORKDIR/ro-dir"
  record_sh A3-readonly-dir "python3 -c \"
try: open('$WORKDIR/ro-dir/herdweb.lock','a+'); print('unexpected')
except OSError as e: print('readonly_dir', type(e).__name__, e)
\"; flock -n -E 42 '$WORKDIR/ro-dir/herdweb.lock' -c 'echo acquired'; echo flock_exit=\$?" || true
  chmod u+w "$WORKDIR/ro-dir" || true
  mkdir -p "$WORKDIR/tmpfs-sim"
  record_sh A3-unlinked "python3 -c \"
import fcntl, os, pathlib
d=pathlib.Path('$WORKDIR/tmpfs-sim'); lock=d/'herdweb.lock'
fh=open(lock,'a+'); fcntl.flock(fh, fcntl.LOCK_EX|fcntl.LOCK_NB)
ino=os.fstat(fh.fileno()).st_ino; lock.unlink(); fh2=open(d/'herdweb.lock','a+')
try:
    fcntl.flock(fh2, fcntl.LOCK_EX|fcntl.LOCK_NB)
    print('double_holder=yes old_inode=%s new_inode=%s'%(ino, os.fstat(fh2.fileno()).st_ino))
except BlockingIOError:
    print('double_holder=no')
fh.close(); fh2.close()
\"" || true
  record_sh A4-two-procs "
    sd='$WORKDIR/state/a4'; mkdir -p \"\$sd\"
    python3 '$PROBE_ROOT/serve.py' --state-dir \"\$sd\" --port $PORT_LEDGER --hold-secs 5 serve & p=\$!
    sleep 0.3
    python3 '$PROBE_ROOT/serve.py' --state-dir \"\$sd\" --port $PORT_ALT serve; echo second_exit=\$?
    wait \$p || true
  " || true
}

probe_b() {
  log "B port attribution"
  local sd="$WORKDIR/state/b"; mkdir -p "$sd"
  python3 -m http.server "$PORT_OCCUPY" --bind 127.0.0.1 >"$EVIDENCE/B5-http.out" 2>&1 &
  local hp=$!; sleep 0.3
  {
    echo "COMMAND: serve.py after http.server $PORT_OCCUPY"
    ss -ltnp | grep ":$PORT_OCCUPY" || true
    "${SERVE[@]}" --state-dir "$sd" --port "$PORT_OCCUPY" --hold-secs 1 serve; echo serve_exit=$?
  } >"$EVIDENCE/B5.txt" 2>&1 || true
  kill "$hp" 2>/dev/null || true; wait "$hp" 2>/dev/null || true
  record_sh B6 "
    sd='$WORKDIR/state/b6'; mkdir -p \"\$sd\"
    python3 '$PROBE_ROOT/serve.py' --state-dir \"\$sd\" --port $PORT_LEDGER --hold-secs 6 serve & p=\$!
    sleep 0.3
    python3 '$PROBE_ROOT/serve.py' --state-dir \"\$sd\" --port $PORT_ALT serve; echo second_exit=\$?
    wait \$p || true
  " || true
}

probe_c() {
  log "C systemd"
  mkdir -p "$WORKDIR/svc/config" "$WORKDIR/state/svc"
  cat >"$WORKDIR/svc/printenv-hold.sh" <<EOF
#!/usr/bin/env bash
set -eu
mkdir -p "\${HERDR_PLUGIN_STATE_DIR}"
printenv | grep -E '^HERDR_|^HERDWEB_|^PWD=|^USER=' | sort > "\${HERDR_PLUGIN_STATE_DIR}/printenv.log"
exec python3 "$PROBE_ROOT/serve.py" --mode service --hold-secs 20 --port "\${HERDWEB_PROBE_PORT}" serve
EOF
  chmod +x "$WORKDIR/svc/printenv-hold.sh"
  write_unit "$UNIT_NAME" "$WORKDIR/svc/printenv-hold.sh" "Restart=no"
  systemctl --user daemon-reload
  record C7-enable systemctl --user enable --now "$UNIT_NAME" || true
  sleep 0.8
  record C7-show systemctl --user show "$UNIT_NAME" -p Environment -p ExecStart -p ActiveState -p Result || true
  cp "$WORKDIR/state/svc/printenv.log" "$EVIDENCE/C7-printenv.log" 2>/dev/null || echo missing >"$EVIDENCE/C7-printenv.log"
  cat >"$WORKDIR/svc/fail.sh" <<EOF
#!/usr/bin/env bash
set -eu
echo "start \$(date -Is) pid=\$\$" >> "$WORKDIR/state/svc/restarts.log"
python3 "$PROBE_ROOT/serve.py" --state-dir "$WORKDIR/state/svc-fail" --port $PORT_FAIL --mode service --hold-secs 0.4 --exit-code 1 serve
EOF
  chmod +x "$WORKDIR/svc/fail.sh"
  mkdir -p "$WORKDIR/state/svc-fail"; : >"$WORKDIR/state/svc/restarts.log"
  write_unit "$UNIT_FAIL_NAME" "$WORKDIR/svc/fail.sh" $'Restart=on-failure\nRestartSec=1'
  python3 -c "
import fcntl, time, pathlib
lock=pathlib.Path('$WORKDIR/state/svc-fail')/'herdweb.lock'
lock.parent.mkdir(parents=True, exist_ok=True)
t0=time.time(); last=None; ev=[]
while time.time()-t0<6:
    fh=open(lock,'a+')
    try:
        fcntl.flock(fh, fcntl.LOCK_EX|fcntl.LOCK_NB); st='free'; fcntl.flock(fh, fcntl.LOCK_UN)
    except BlockingIOError:
        st='held'
    fh.close()
    if st!=last: ev.append((st, round(time.time()-t0,4))); last=st
    time.sleep(0.02)
print('samples', ev[:40], 'count', len(ev))
" >"$EVIDENCE/C8-window.txt" 2>&1 &
  local watcher=$!
  systemctl --user daemon-reload
  record C8-enable systemctl --user enable --now "$UNIT_FAIL_NAME" || true
  sleep 6; wait "$watcher" 2>/dev/null || true
  record C8-journal journalctl --user -u "$UNIT_FAIL_NAME" -n 20 --no-pager || true
  cp "$WORKDIR/state/svc/restarts.log" "$EVIDENCE/C8-restarts.log" 2>/dev/null || true
  systemctl --user disable --now "$UNIT_FAIL_NAME" >/dev/null 2>&1 || true
  {
    echo "COMMAND: loginctl show-user linger"
    loginctl show-user "$USER" -p Linger -p Sessions
    echo "NOTE: Linger=yes; will not disable-linger or terminate-user."
  } >"$EVIDENCE/C9.txt"
  mkdir -p "$WORKDIR/stale-checkout"
  printf '%s\n' '#!/usr/bin/env bash' 'sleep 30' >"$WORKDIR/stale-checkout/run.sh"
  chmod +x "$WORKDIR/stale-checkout/run.sh"
  cat >"$USER_UNIT_DIR/$UNIT_STALE_NAME" <<EOF
[Unit]
Description=herdweb probe stale
[Service]
WorkingDirectory=$WORKDIR/stale-checkout
ExecStart=$WORKDIR/stale-checkout/run.sh
EOF
  systemctl --user daemon-reload
  systemctl --user start "$UNIT_STALE_NAME" || true; sleep 0.3
  record C10-status-before systemctl --user status "$UNIT_STALE_NAME" --no-pager -l || true
  systemctl --user stop "$UNIT_STALE_NAME" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR/stale-checkout"
  systemctl --user start "$UNIT_STALE_NAME" || true; sleep 0.3
  record C10-status-after systemctl --user status "$UNIT_STALE_NAME" --no-pager -l || true
  record C10-show systemctl --user show "$UNIT_STALE_NAME" -p ExecMainStatus -p Result -p ExecStart || true
  systemctl --user disable --now "$UNIT_NAME" "$UNIT_FAIL_NAME" "$UNIT_STALE_NAME" >/dev/null 2>&1 || true
  rm -f "$USER_UNIT_DIR/$UNIT_NAME" "$USER_UNIT_DIR/$UNIT_FAIL_NAME" "$USER_UNIT_DIR/$UNIT_STALE_NAME"
  systemctl --user daemon-reload
  systemctl --user reset-failed "$UNIT_NAME" "$UNIT_FAIL_NAME" "$UNIT_STALE_NAME" >/dev/null 2>&1 || true
  {
    echo "COMMAND: leftover herdweb-probe units"
    systemctl --user list-units --all 'herdweb-probe-*' --no-pager || true
    ls "$USER_UNIT_DIR"/herdweb-probe-* 2>/dev/null || echo "unit files: none"
    test ! -e "$USER_UNIT_DIR/$UNIT_NAME" && echo UNIT_NAME_ABSENT=yes
  } >"$EVIDENCE/C11.txt"
}

probe_d() {
  log "D herdr plugin"
  install_plugin
  record D12-list herdr plugin list || true
  record D12-actions herdr plugin action list --plugin "$PLUGIN_ID" || true
  herdr plugin config-dir "$PLUGIN_ID" >"$EVIDENCE/D12-config-dir.txt" 2>&1 || true
  ensure_session "$SESSION_A"; ensure_session "$SESSION_B"
  record D13-s1 herdr --session "$SESSION_A" plugin action invoke dump-env --plugin "$PLUGIN_ID" || true
  record D13-s2 herdr --session "$SESSION_B" plugin action invoke dump-env --plugin "$PLUGIN_ID" || true
  sleep 1
  local st="$HOME/.local/state/herdr/plugins/$PLUGIN_ID"
  {
    echo "config-dir=$(cat "$EVIDENCE/D12-config-dir.txt")"
    echo "state-dir=$st"
    echo "s1-sock=$HOME/.config/herdr/sessions/$SESSION_A/herdr.sock"
    echo "s2-sock=$HOME/.config/herdr/sessions/$SESSION_B/herdr.sock"
    echo "default-sock=$HOME/.config/herdr/herdr.sock"
    ls -la "$st" 2>/dev/null || true
  } >"$EVIDENCE/D13-dirs.txt"
  cat "$st"/dump-env*.txt >"$EVIDENCE/D13-env-files.txt" 2>/dev/null || true
  record D14-fail-s1 herdr --session "$SESSION_A" plugin action invoke fail-now --plugin "$PLUGIN_ID" || true
  record D14-fail-default herdr plugin action invoke fail-now --plugin "$PLUGIN_ID" || true
  sleep 1
  record D14-logs-s1 herdr --session "$SESSION_A" plugin log list --plugin "$PLUGIN_ID" --limit 10 || true
  record D14-logs-default herdr plugin log list --plugin "$PLUGIN_ID" --limit 10 || true
  record D15-default herdr plugin action invoke dump-env --plugin "$PLUGIN_ID" || true
  record D15-ws-s1 herdr --session "$SESSION_A" workspace list || true
  : >"$st/pane-env.txt"
  record D16-open-s1 herdr --session "$SESSION_A" plugin pane open --plugin "$PLUGIN_ID" --entrypoint hold --no-focus || true
  sleep 1.5
  record D16-panes-s1 herdr --session "$SESSION_A" pane list || true
  cp "$st/pane-env.txt" "$EVIDENCE/D16-pane-env.txt" 2>/dev/null || true
  herdr --session "$SESSION_A" plugin pane close --plugin "$PLUGIN_ID" --entrypoint hold >/dev/null 2>&1 || true
  export HERDWEB_PROBE_PORT="$PORT_LEDGER"
  record A4-s1 herdr --session "$SESSION_A" plugin action invoke try-serve --plugin "$PLUGIN_ID" || true
  sleep 1
  record A4-s2 herdr --session "$SESSION_B" plugin action invoke try-serve --plugin "$PLUGIN_ID" || true
  sleep 9
  record A4-logs-s1 herdr --session "$SESSION_A" plugin log list --plugin "$PLUGIN_ID" --limit 8 || true
  record A4-logs-s2 herdr --session "$SESSION_B" plugin log list --plugin "$PLUGIN_ID" --limit 8 || true
}

main() {
  ensure_workdir
  snapshot_env "$SNAP_BEFORE"; extract_pids >"$WORKDIR/pids-before.txt"
  trap 'cleanup_all' EXIT
  [ "${PROBE_ONLY:-}" = D ] || { probe_a; probe_b; probe_c; }
  probe_d
  cleanup_all; trap - EXIT
  snapshot_env "$SNAP_AFTER"; extract_pids >"$WORKDIR/pids-after.txt"
  {
    echo "## pid compare"; echo BEFORE; cat "$WORKDIR/pids-before.txt"
    echo AFTER; cat "$WORKDIR/pids-after.txt"
    echo "## 7681"; ss -ltn | grep 7681 || echo MISSING
    echo "## units"; ls "$USER_UNIT_DIR"/herdweb-probe-* 2>/dev/null || echo none
    echo "## plugins"; herdr plugin list || true
    echo "## sessions"; herdr session list || true
  } >"$EVIDENCE/restore.txt"
  log "evidence in $EVIDENCE"
}
main "$@"
