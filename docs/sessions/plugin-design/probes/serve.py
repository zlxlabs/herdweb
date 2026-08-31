#!/usr/bin/env python3
"""Minimal flock+owner.json ledger runner for herdweb plugin probes.

Binds 127.0.0.1 only. Port comes from HERDWEB_PROBE_PORT / --port (never 7681).
Mirrors design.md §2.8 start order: flock → read port → write owner.json → bind.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
import socket
import sys
import time
from pathlib import Path

LOCK_NAME = "herdweb.lock"
OWNER_NAME = "herdweb.owner.json"

def proc_starttime(pid: int) -> str | None:
    path = Path(f"/proc/{pid}/stat")
    if not path.exists():
        return None
    text = path.read_text(errors="replace")
    rest = text[text.rfind(")") + 2 :].split()
    # field 22 starttime; after dropping pid+comm, index 19.
    return rest[19] if len(rest) > 19 else None

def owner_path(state_dir: Path) -> Path:
    return state_dir / OWNER_NAME

def read_owner(state_dir: Path) -> dict | None:
    p = owner_path(state_dir)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return {"_parse_error": str(exc)}

def diagnose_owner(owner: dict | None) -> dict:
    """Classify leftover owner.json. Callers must already know lock state."""
    if not owner or "_parse_error" in owner:
        return {"verdict": "missing_or_corrupt", "owner": owner}
    pid = owner.get("pid")
    recorded = str(owner.get("starttime") or "")
    if not isinstance(pid, int):
        return {"verdict": "malformed", "owner": owner}
    live = Path(f"/proc/{pid}").exists()
    current = proc_starttime(pid) if live else None
    if not live:
        return {"verdict": "stale_dead_pid", "owner": owner}
    if recorded and current and recorded != current:
        return {
            "verdict": "stale_pid_reused",
            "owner": owner,
            "current_starttime": current,
        }
    return {"verdict": "live", "owner": owner, "current_starttime": current}

def report_lock_held(state_dir: Path) -> int:
    diag = diagnose_owner(read_owner(state_dir))
    owner = diag.get("owner") or {}
    verdict = diag["verdict"]
    if verdict == "live":
        msg = (
            f"LOCK_HELD pid={owner.get('pid')} mode={owner.get('mode')} "
            f"port={owner.get('port')} (another herdweb is running)"
        )
    else:
        msg = (
            f"LOCK_HELD owner.json is {verdict}; cannot name the locker. "
            "lock is held but owner metadata is stale or missing"
        )
    print(msg, file=sys.stderr)
    print(json.dumps({"code": "LOCK_HELD", **diag}, ensure_ascii=False))
    return 2

def write_owner(state_dir: Path, payload: dict) -> None:
    p = owner_path(state_dir)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(p)

def open_lock(state_dir: Path) -> tuple[object, bool]:
    state_dir.mkdir(parents=True, exist_ok=True)
    fh = open(state_dir / LOCK_NAME, "a+")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fh, True
    except BlockingIOError:
        return fh, False

def bind_loopback(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(8)
    return sock

def cmd_serve(args: argparse.Namespace) -> int:
    state_dir = Path(args.state_dir)
    port = args.port
    fh, ok = open_lock(state_dir)
    if not ok:
        fh.close()
        return report_lock_held(state_dir)
    pid = os.getpid()
    payload = {
        "pid": pid,
        "starttime": proc_starttime(pid),
        "mode": args.mode,
        "port": port,
        "config_path": args.config_path,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "herdr_tab_id": os.environ.get("HERDR_TAB_ID"),
    }
    write_owner(state_dir, payload)
    try:
        sock = bind_loopback(port)
    except OSError as exc:
        print(
            f"PORT_OCCUPIED port={port} (got the lock; occupant is not this ledger): {exc}",
            file=sys.stderr,
        )
        print(json.dumps({"code": "PORT_OCCUPIED", "port": port, "error": str(exc)}))
        owner_path(state_dir).unlink(missing_ok=True)
        fh.close()
        return 3
    print(json.dumps({"code": "LISTENING", **payload}, ensure_ascii=False), flush=True)
    stop = False

    def _stop(signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    deadline = time.time() + args.hold_secs if args.hold_secs > 0 else None
    sock.settimeout(0.2)
    try:
        while not stop:
            if deadline is not None and time.time() >= deadline:
                break
            try:
                conn, _addr = sock.accept()
                conn.close()
            except TimeoutError:
                pass
    finally:
        sock.close()
        owner_path(state_dir).unlink(missing_ok=True)
        fh.close()
    return args.exit_code

def cmd_try_lock(args: argparse.Namespace) -> int:
    fh, ok = open_lock(Path(args.state_dir))
    print(json.dumps({"acquired": ok, "pid": os.getpid()}))
    if not ok:
        fh.close()
        return 2
    if args.hold_secs > 0:
        time.sleep(args.hold_secs)
    fh.close()
    return 0

def cmd_diagnose(args: argparse.Namespace) -> int:
    print(json.dumps(diagnose_owner(read_owner(Path(args.state_dir))), ensure_ascii=False, indent=2))
    return 0

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--state-dir", default=os.environ.get("HERDR_PLUGIN_STATE_DIR", ""))
    p.add_argument("--port", type=int, default=int(os.environ.get("HERDWEB_PROBE_PORT", "17682")))
    p.add_argument("--mode", default="pane", choices=("pane", "service"))
    p.add_argument("--config-path", default=os.environ.get("HERDR_PLUGIN_CONFIG_DIR", ""))
    p.add_argument("--hold-secs", type=float, default=0)
    p.add_argument("--exit-code", type=int, default=0)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve")
    sub.add_parser("try-lock")
    sub.add_parser("diagnose")
    args = p.parse_args()
    if not args.state_dir:
        print("state-dir required", file=sys.stderr)
        return 1
    if args.port == 7681:
        print("refusing port 7681", file=sys.stderr)
        return 1
    if args.cmd == "serve":
        return cmd_serve(args)
    if args.cmd == "try-lock":
        return cmd_try_lock(args)
    return cmd_diagnose(args)

if __name__ == "__main__":
    sys.exit(main())
