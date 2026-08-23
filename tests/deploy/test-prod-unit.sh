#!/usr/bin/env bash
# Production systemd and serve-prod.sh contract tests; no service is started.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="$ROOT/systemd/herdweb.service"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
has() { grep -F -- "$2" "$1" >/dev/null || fail "$3"; }

[[ -x "$ROOT/scripts/serve-prod.sh" ]] || fail 'serve-prod.sh is not executable'
[[ -x "$ROOT/scripts/install-prod.sh" ]] || fail 'install-prod.sh is not executable'
[[ -x "$ROOT/scripts/install-debug.sh" ]] || fail 'install-debug.sh is not executable'
[[ -x "$ROOT/scripts/update-prod.sh" ]] || fail 'update-prod.sh is not executable'
has "$UNIT" 'WorkingDirectory=/home/zlx/.local/share/herdweb' 'production path must be the XDG deployment clone'
has "$UNIT" 'ExecStart=/home/zlx/.local/share/herdweb/scripts/serve-prod.sh serve --host 127.0.0.1 --port 7681 -- herdr --session default' 'production command contract changed'
has "$UNIT" 'Environment=PATH=/home/zlx/.local/share/fnm/aliases/default/bin:/home/zlx/.local/bin:' 'production PATH must use fnm default alias'
grep -F -- 'node-versions/' "$UNIT" >/dev/null && fail 'production PATH must not pin node-versions'
grep -F -- '0.0.0.0' "$UNIT" >/dev/null && fail 'production unit must remain loopback-only'
grep -Fx -- '[Install]' "$UNIT" >/dev/null || fail 'production unit must be installable'
has "$ROOT/scripts/install-prod.sh" 'UNIT_SOURCE="${REPO_ROOT}/systemd/herdweb.service"' 'prod installer must only install prod unit'
grep -F -- 'herdweb-debug.service' "$ROOT/scripts/install-prod.sh" >/dev/null && fail 'prod installer must not install debug unit'
has "$ROOT/scripts/install-debug.sh" 'UNIT_SOURCE="${REPO_ROOT}/systemd/herdweb-debug.service"' 'debug installer contract missing'

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir "$TMP/bin"
cat > "$TMP/bin/git" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == -C && "$3" == symbolic-ref && "$4" == --quiet && "$5" == --short && "$6" == HEAD ]] || exit 99
printf '%s\n' "${GIT_BRANCH}"
EOF
cat > "$TMP/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE"
EOF
chmod +x "$TMP/bin/git" "$TMP/bin/pnpm"
printf '%s\n' exec tsx cli.ts serve --host 127.0.0.1 --port 7681 -- herdr --session default > "$TMP/expected"
GIT_BRANCH=main CAPTURE="$TMP/args" PATH="$TMP/bin:/usr/bin:/bin" \
  "$ROOT/scripts/serve-prod.sh" serve --host 127.0.0.1 --port 7681 -- herdr --session default
diff -u "$TMP/expected" "$TMP/args" || fail 'serve-prod.sh emitted the wrong pnpm argv'
rm -f "$TMP/args"
if GIT_BRANCH=card/test CAPTURE="$TMP/args" PATH="$TMP/bin:/usr/bin:/bin" \
  "$ROOT/scripts/serve-prod.sh" serve --host 127.0.0.1 --port 7681; then
  fail 'serve-prod.sh accepted a non-main branch'
fi
[[ ! -e "$TMP/args" ]] || fail 'serve-prod.sh invoked pnpm after rejecting the branch'
printf 'PASS: production unit, installer split, and serve-prod branch/argv contracts\n'
