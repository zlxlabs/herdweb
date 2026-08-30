#!/usr/bin/env bash
# Debug systemd contract tests; no service is started or enabled.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="$ROOT/systemd/herdweb-debug.service"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
has() { grep -F -- "$2" "$1" >/dev/null || fail "$3"; }

has "$UNIT" 'WorkingDirectory=/home/zlx/projects/oss/herdweb' 'debug path must be canonical main repo'
has "$UNIT" 'ExecStart=/home/zlx/.local/share/fnm/aliases/default/bin/pnpm exec tsx cli.ts serve --host 127.0.0.1 --port 7691 --base-path /herdweb --config /home/zlx/projects/oss/herdweb/.omo/herdweb-debug.config.ts' 'debug command contract changed'
has "$UNIT" 'Environment=PATH=/home/zlx/.local/share/fnm/aliases/default/bin:/home/zlx/.local/bin:' 'debug PATH must use fnm default alias'
grep -Fx -- '[Install]' "$UNIT" >/dev/null && fail 'debug unit must not have [Install]'
grep -F -- 'serve-prod.sh' "$UNIT" >/dev/null && fail 'debug unit must not require main branch'
grep -F -- '0.0.0.0' "$UNIT" >/dev/null && fail 'debug unit must remain loopback-only'
grep -F -- '--port 7681' "$UNIT" >/dev/null && fail 'debug unit must not occupy production port'
grep -E -- 'systemctl --user (enable|enable --now|start)' "$ROOT/scripts/install-debug.sh" >/dev/null && fail 'debug installer must not enable or start the unit'
printf 'PASS: debug unit and non-enabling installer contracts\n'
