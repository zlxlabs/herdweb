# Remaining Chromium `page.goto` hang after media=print (issue #135 leftover)

Recorded 2026-08-31 on worktree `herdweb-20260831-11`, base `f22d4be3fefa8fa7246b1ef71015fc958eeb8e9a` (`origin/main`). Candidate 1 already emits the font tag as `media="print"` (PR #139). This file is the hang-trace for the leftover kind (a) cells in `docs/sessions/herdweb-e2e-flake/baseline-after-c1-c2.md` (14 instances). It does **not** reuse `chromium-nav-diagnosis.md` (that capture was before media=print).

Traces and JSON stay in `/tmp/herdweb-chromium-nav-remain-20260831/` and are not committed.

## Method

Full suite, both Playwright projects, `retries: 0` (`CI` unset). Trace via CLI only (`playwright.config.ts` untouched):

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/herdweb-chromium-nav-remain-20260831/diag-r1/results.json \
  /usr/bin/time -f 'WALL_SECONDS=%e' \
  env -u CI pnpm exec playwright test \
    --trace retain-on-failure \
    --output /tmp/herdweb-chromium-nav-remain-20260831/diag-r1/test-results \
    --reporter=line --reporter=json
```

`--trace retain-on-failure` (not `--trace on`) so passing tests do not pay the full trace cost. Observer-effect note: this flag was on for the counted diagnostic round below. A Chromium `timedOut` still happened with trace on.

Network / lifecycle facts below are walked from the failure's `trace.zip` (`0-trace.network` resource snapshots + `0-trace.trace` / `test.trace` API log), not from terminal summary text.

## Idle check

Immediately before diagnostic round 1, 2026-08-31T13:44:32+08:00. `pgrep -af` is blocked in this shell; the check used `ps -eo pid,args` and kept lines matching `playwright|vitest|tsdown`.

Unfiltered matches:

```
2302548 /usr/bin/zsh -c ... IDLE CHECK ... ps -eo pid,args | awk ... /playwright|vitest|tsdown/ ...
2302561 awk BEGIN{IGNORECASE=1} /playwright|vitest|tsdown/ {print}
```

After dropping the idle-check wrapper and its `awk`: **empty**. No leftover Playwright / Vitest / tsdown worker. Rounds were serial. `pnpm test` was not started.

The delegate shell inherited `CI=true`. Every counted Playwright command unsets it (`env -u CI`) so `playwright.config.ts` keeps `retries: 0`. Evidence: the JSON result below has `retry: 0`.

## Diagnostic round 1 (trace on)

- Start: `2026-08-31T13:44:52+08:00`
- Wall clock: `WALL_SECONDS=80.43` (`/usr/bin/time`)
- JSON path: `/tmp/herdweb-chromium-nav-remain-20260831/diag-r1/results.json` (149863 bytes)
- JSON stats: `expected=109 skipped=8 unexpected=1 flaky=0` (118 rows)
- Status mix walked from `suites[].specs[].tests[].results[]`: `passed=109 skipped=8 timedOut=1`
- Kind (a) (`status=timedOut` and duration ≥ 29_000 ms): **1**
- By project: chromium `timedOut=1`; webkit clean in this round
- `retry` values: `{0}`

One Chromium hang is enough to name the pending URL. A second traced full suite was not started.

## Hang — `keyboard-toggle.spec.ts` beforeEach, waiting until `load`

- **Spec / line:** `tests/playwright/keyboard-toggle.spec.ts` test at line 60 (`onFocusChange fires on real textarea focus and blur`); hang is the shared `beforeEach` at line 17 `page.goto('/')`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30127` ms, start `2026-08-31T05:44:59.256Z`, `retry=0`
- **Error first line (ANSI stripped):** `Test timeout of 30000ms exceeded while running "beforeEach" hook.`
- **Second error (goto, ANSI stripped):**

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:39803/", waiting until "load"
```

Stack points at `keyboard-toggle.spec.ts:17:13` (`await page.goto('/')`). Does **not** contain `while setting up "serve"`.

- **Trace:** `/tmp/herdweb-chromium-nav-remain-20260831/diag-r1/test-results/keyboard-toggle-onFocusCha-b0219-eal-textarea-focus-and-blur-chromium-android/trace.zip`
- **`test.trace`:** Fixture `"serve"` completed (`endTime=5868.034`); next navigation step is `Navigate to "/"` (`pw:api@29`) with `params.url="/" waitUntil="load" timeout="0"`. That call never gets a successful `after`. Error event: `Test timeout of 30000ms exceeded while running "beforeEach" hook.`
- **`0-trace.trace`:** log line `navigating to "http://127.0.0.1:39803/", waiting until "load"`. No `after` for this call. Pre-goto snapshot `frameUrl=about:blank`.
- **Pending requests** (from `0-trace.network` resource snapshots):
  1. `GET http://127.0.0.1:39803/` — **done**, `time=5.486` ms, HTTP 200, `mime=text/html; charset=UTF-8`, started `2026-08-31T05:44:59.949Z`
  2. `GET http://127.0.0.1:39803/sw.js` — **done**, `time=9.366` ms, HTTP 200, `mime=application/javascript`, started `2026-08-31T05:45:00.035Z`
  3. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/jetbrainsmono-nfm.css` — **pending**, HAR `time=-1`, response `status=-1`, `mimeType=x-unknown`, empty response headers, timings `send/wait/receive=-1`, started `2026-08-31T05:45:00.040Z` (91 ms after the document). Not `_failed` / not `_canceled`. No woff2 request appears in this HAR.
- **`load`:** not fired. `page.goto` stayed on `waiting until "load"` until the suite timeout.

The captured HTML resource in the same zip (`resources/9c79d265236b925f631613abe87afbd14a8efba6.html`, 527863 bytes) already has candidate 1's print media on the first `<head>` link:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/jetbrainsmono-nfm.css" media="print" data-herdweb-font>
```

## What this rules in

The leftover Chromium kind (a) hang is still the font CSS URL, even after `media="print"`. Chromium still waits for that `rel="stylesheet"` on `window` `load`. The pending resource is the CSS file itself, not a later woff2. Switching `media` to `all` in the bundle cannot be the first-order cause of *this* capture: the request is already outstanding from the initial HTML tag.

The one product change this card will make: stop emitting a font `rel="stylesheet"` in the initial HTML, and inject that stylesheet only after the `load` event so a hung jsDelivr CSS cannot stall `page.goto({ waitUntil: 'load' })`.
