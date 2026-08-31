#!/usr/bin/env bash
# Reproduce herdweb's proposed plugin-install build chain on clean Docker images.
#
# Usage (any cwd; repo is detected via git):
#   bash docs/sessions/plugin-design/probes/build-matrix.sh
#
# Env:
#   OUT_DIR  results dir (default: /tmp/herdweb-build-matrix-<pid>)
#   ONLY     comma-separated cell ids (1,2,3,4,5,s1,p1)
#   TIMEOUT  seconds per docker cell (default 900)
#
# Each cell is independent: a failure does not skip later cells.
set -uo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
OUT_DIR="${OUT_DIR:-/tmp/herdweb-build-matrix-$$}"
TIMEOUT="${TIMEOUT:-900}"
ONLY="${ONLY:-}"
IMAGES=(node:22-slim node:22 node:22-alpine)

mkdir -p "$OUT_DIR"
SRC_TAR="$OUT_DIR/src.tar"
INNER="$OUT_DIR/inner.sh"
SUMMARY="$OUT_DIR/summary.tsv"

git -C "$ROOT" archive --format=tar HEAD >"$SRC_TAR"

cat >"$INNER" <<'INNER'
#!/bin/sh
set +e
CELL="$1"
OUT=/out
mkdir -p /work
tar -xf /src.tar -C /work
cd /work || exit 1

export npm_config_update_notifier=false
export npm_config_fund=false
export npm_config_audit=false
export CI=1

if [ "$CELL" = "2" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >"$OUT/apt.log" 2>&1
  apt-get install -y --no-install-recommends python3 make g++ >>"$OUT/apt.log" 2>&1
  echo $? >"$OUT/apt.exit"
fi

{
  echo "node=$(node -p process.version)"
  echo "arch=$(uname -m)"
  echo "platform=$(node -p process.platform)"
  command -v python3 >/dev/null && python3 --version || echo "python3=missing"
  command -v make >/dev/null && echo "make=$(command -v make)" || echo "make=missing"
  command -v g++ >/dev/null && echo "g++=$(command -v g++)" || echo "g++=missing"
  command -v cc >/dev/null && echo "cc=$(command -v cc)" || echo "cc=missing"
  npx --yes pnpm@10 --version 2>/dev/null | awk '{print "pnpm="$0}'
  sed -n '1,4p' /etc/os-release 2>/dev/null
} >"$OUT/env.txt" 2>&1

INSTALL_ARGS="install --frozen-lockfile"
[ "$CELL" = "s1" ] && INSTALL_ARGS="install --frozen-lockfile --ignore-scripts"

t0=$(date +%s)
# shellcheck disable=SC2086
npx --yes pnpm@10 $INSTALL_ARGS >"$OUT/install.log" 2>&1
inst=$?
t1=$(date +%s)
echo "$inst $((t1 - t0))" >"$OUT/install.status"

if [ "$inst" -eq 0 ]; then
  t2=$(date +%s)
  npx --yes pnpm@10 run build:dist >"$OUT/build.log" 2>&1
  bld=$?
  t3=$(date +%s)
  echo "$bld $((t3 - t2))" >"$OUT/build.status"
else
  : >"$OUT/build.log"
  echo "skipped 0" >"$OUT/build.status"
  bld=skipped
fi

find node_modules -name 'pty.node' 2>/dev/null | sort >"$OUT/node-pty-binaries.txt"
ls -la dist 2>/dev/null >"$OUT/dist.ls" || echo "no dist/" >"$OUT/dist.ls"
ls -la node_modules/node-pty/prebuilds 2>/dev/null >"$OUT/prebuilds.ls" || echo "no prebuilds/" >"$OUT/prebuilds.ls"
ls -la node_modules/node-pty/prebuilds/linux-x64 2>/dev/null >"$OUT/prebuilds-linux.ls" || echo "no linux-x64 prebuild dir" >"$OUT/prebuilds-linux.ls"

node -e '
try {
  require("node-pty");
  console.log("require=ok");
} catch (e) {
  console.log("require=fail");
  console.log(String(e && e.message ? e.message : e).split("\n")[0]);
}
' >"$OUT/require-pty.txt" 2>&1

grep -nE 'node-gyp|gyp info|gyp ERR|CXX\(target\)|prebuild|Checking prebuilds|Rebuilding because|Ignored build|onlyBuiltDependencies|allowBuilds' \
  "$OUT/install.log" "$OUT/build.log" >"$OUT/gyp-hits.txt" 2>/dev/null

echo "install_exit=$inst" >"$OUT/cell.env"
echo "build_exit=$bld" >>"$OUT/cell.env"
if [ "$inst" -ne 0 ]; then
  exit "$inst"
fi
if [ "$bld" != "skipped" ] && [ "$bld" -ne 0 ]; then
  exit "$bld"
fi
exit 0
INNER
chmod +x "$INNER"

want() {
  local id="$1"
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in
    *",$id,"*) return 0 ;;
    *) return 1 ;;
  esac
}

run_cell() {
  local id="$1" image="$2"
  local cell="$OUT_DIR/cell-$id"
  rm -rf "$cell"
  mkdir -p "$cell"
  echo "=== cell $id image=$image ==="
  local extra_e=()
  if [ "$id" = "5" ]; then
    extra_e=(-e npm_config_build_from_source=false -e npm_config_fallback_to_build=false)
  fi
  local t0 t1 rc
  t0=$(date +%s)
  timeout "$TIMEOUT" docker run --rm \
    --name "herdweb-probe-$id" \
    "${extra_e[@]}" \
    -v "$SRC_TAR:/src.tar:ro" \
    -v "$INNER:/probe.sh:ro" \
    -v "$cell:/out" \
    "$image" sh /probe.sh "$id" >"$cell/docker.stdout" 2>"$cell/docker.stderr"
  rc=$?
  t1=$(date +%s)
  echo "$rc $((t1 - t0))" >"$cell/docker.status"
  # First 30 lines of the failed step (install log if install failed, else build log).
  local fail_log="$cell/install.log"
  if [ -f "$cell/install.status" ]; then
    read -r inst _ <"$cell/install.status"
    if [ "${inst:-1}" = "0" ] && [ -s "$cell/build.log" ]; then
      read -r bld _ <"$cell/build.status" || true
      [ "${bld:-1}" != "0" ] && [ "${bld:-}" != "skipped" ] && fail_log="$cell/build.log"
    fi
  fi
  if [ "$rc" -ne 0 ] || { [ -f "$cell/install.status" ] && [ "$(cut -d' ' -f1 "$cell/install.status")" != "0" ]; }; then
    awk 'NR<=30 {print}' "$fail_log" >"$cell/error-head.txt" 2>/dev/null || true
  else
    : >"$cell/error-head.txt"
  fi
  echo "cell $id docker_exit=$rc elapsed=$((t1 - t0))s"
}

echo "=== pulling images ==="
for img in "${IMAGES[@]}"; do
  docker pull "$img"
  docker image inspect "$img" --format '{{.RepoDigests}} {{.Id}} {{.Os}}/{{.Architecture}}' \
    >"$OUT_DIR/image-$(echo "$img" | tr ':/' '--').txt"
done

printf 'id\tdocker_exit\tinstall_exit\tinstall_s\tbuild_exit\tbuild_s\tgyp\tpty.node\tdist\trequire\n' >"$SUMMARY"

want 1 && run_cell 1 node:22-slim
want 2 && run_cell 2 node:22-slim
want 3 && run_cell 3 node:22
want 4 && run_cell 4 node:22-alpine
want 5 && run_cell 5 node:22-slim
want s1 && run_cell s1 node:22-slim

if want p1; then
  echo "=== cell p1 node-pty npm tarball listing ==="
  p1="$OUT_DIR/cell-p1"
  rm -rf "$p1"
  mkdir -p "$p1"
  timeout "$TIMEOUT" docker run --rm \
    -v "$p1:/out" \
    node:22-slim sh -c '
      set +e
      cd /tmp
      npm pack node-pty@1.1.0 > /out/npm-pack.log 2>&1
      tar -tzf node-pty-1.1.0.tgz > /out/tarball.list
      echo "file_count=$(wc -l < /out/tarball.list)" > /out/meta.txt
      echo "tgz_bytes=$(wc -c < node-pty-1.1.0.tgz)" >> /out/meta.txt
      grep -E "prebuilds/|\.node$|scripts/prebuild" /out/tarball.list > /out/prebuild-files.txt
      tar -xOf node-pty-1.1.0.tgz package/package.json > /out/package.json
      tar -xOf node-pty-1.1.0.tgz package/scripts/prebuild.js > /out/prebuild.js
    ' >"$p1/docker.stdout" 2>"$p1/docker.stderr"
  echo $? >"$p1/docker.exit"
fi

python3 - <<'PY' "$OUT_DIR" "$SUMMARY"
import pathlib, sys
out = pathlib.Path(sys.argv[1])
summary = pathlib.Path(sys.argv[2])
rows = []
for cell_dir in sorted(out.glob("cell-*")):
    cid = cell_dir.name.split("-", 1)[1]
    if cid == "p1":
        continue
    def status(name):
        p = cell_dir / name
        if not p.exists():
            return "na", "na"
        parts = p.read_text().split()
        if len(parts) >= 2:
            return parts[0], parts[1]
        return parts[0] if parts else "na", "na"
    docker_rc, docker_s = status("docker.status")
    inst_rc, inst_s = status("install.status")
    bld_rc, bld_s = status("build.status")
    gyp = "no"
    hits = cell_dir / "gyp-hits.txt"
    if hits.exists():
        t = hits.read_text()
        if "node-gyp" in t or "gyp ERR" in t or "gyp info" in t or "CXX(target)" in t:
            gyp = "yes"
        elif "Checking prebuilds" in t or "Rebuilding because" in t:
            gyp = "prebuild-check"
    binaries = cell_dir / "node-pty-binaries.txt"
    pty = "yes" if binaries.exists() and binaries.read_text().strip() else "no"
    dist_ls = cell_dir / "dist.ls"
    if dist_ls.exists():
        dist = "no" if dist_ls.read_text().startswith("no dist") else "yes"
    else:
        dist = "na"
    req = "na"
    rp = cell_dir / "require-pty.txt"
    if rp.exists():
        req = "ok" if "require=ok" in rp.read_text() else "fail"
    rows.append((cid, docker_rc, inst_rc, inst_s, bld_rc, bld_s, gyp, pty, dist, req))

with summary.open("a") as f:
    for r in rows:
        f.write("\t".join(r) + "\n")
print(summary.read_text())
PY

echo "results in $OUT_DIR"
