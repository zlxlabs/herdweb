#!/usr/bin/env bash
# Debug systemd contract tests; no service is started or enabled.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="$ROOT/systemd/herdweb-debug.service"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# Compare whole directive lines, not prefixes: a prefix match let a trailing
# `-- <command>` reappear on ExecStart unnoticed, which is exactly the drift
# that crash-looped the unit before. Normalize first so the comparison rejects
# only real contract changes — systemd ignores leading whitespace, whitespace
# around the first `=`, and CRLF line endings, so none of those are drift.
# Whitespace inside the value is left alone; it separates real arguments.
UNIT_LINES="$(sed -e 's/\r$//' \
	-e 's/^[[:space:]]*//' \
	-e 's/[[:space:]]*$//' \
	-e 's/^\([^=]*[^=[:space:]]\)[[:space:]]*=[[:space:]]*/\1=/' \
	-- "$UNIT")"

has() { grep -qxF -- "$1" <<<"$UNIT_LINES" || fail "$2"; }
lacks() { grep -qF -- "$1" <<<"$UNIT_LINES" && fail "$2"; return 0; }

has 'WorkingDirectory=/home/zlx/projects/oss/herdweb' 'debug path must be canonical main repo'
has 'ExecStart=/home/zlx/.local/share/fnm/aliases/default/bin/pnpm exec tsx cli.ts serve --host 127.0.0.1 --port 7691 --base-path /herdweb --config /home/zlx/projects/oss/herdweb/.omo/herdweb-debug.config.ts' 'debug command contract changed'
has 'Environment=PATH=/home/zlx/.local/share/fnm/aliases/default/bin:/home/zlx/.local/bin:/usr/local/bin:/usr/bin:/bin' 'debug PATH must use fnm default alias'
lacks '[Install]' 'debug unit must not have [Install]'
lacks 'serve-prod.sh' 'debug unit must not require main branch'
lacks '0.0.0.0' 'debug unit must remain loopback-only'
lacks '--port 7681' 'debug unit must not occupy production port'
grep -E -- 'systemctl --user (enable|enable --now|start)' "$ROOT/scripts/install-debug.sh" >/dev/null && fail 'debug installer must not enable or start the unit'
printf 'PASS: debug unit and non-enabling installer contracts\n'
