# Chromium `page.goto` never reaches `load` (issue #135 candidate 1)

Recorded 2026-08-31 on worktree `herdweb-20260831-02`, base `445e3c026b81beab88bc6b8b063bdc18e99d3a4f` (`main`). This file is the diagnosis for the chromium navigation timeout named in `docs/sessions/herdweb-e2e-flake/baseline.md`. No product or test code was changed.

Traces and JSON stay in `/tmp/herdweb-chromium-nav/` and are not committed.

## Method

Full suite, both Playwright projects, `retries: 0` (`CI` unset). Trace via CLI only (`playwright.config.ts` untouched):

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/herdweb-chromium-nav/rN/results.json \
  /usr/bin/time -f 'WALL_SECONDS=%e' \
  pnpm exec playwright test \
    --trace retain-on-failure \
    --output /tmp/herdweb-chromium-nav/rN/test-results \
    --reporter=line --reporter=json
```

`--trace retain-on-failure` (not `--trace on`) so passing tests do not pay the full trace cost. Observer-effect note: this flag was on for every counted round below. Timeouts **still happened** with trace on; the analysis does not reuse the no-trace baseline.json as a substitute for these traces.

Network / lifecycle facts below are walked from each failure's `trace.zip` (`0-trace.network` HAR snapshots + `0-trace.trace` / `test.trace` API log), not from terminal summary text.

## Idle check

Immediately before round 1, 2026-08-31T01:19:00+08:00. Command: `pgrep -af 'playwright|vitest|tsdown'`.

Unfiltered (argv truncated at 160 chars in this log; full argv of PID 3748915 is the dispatch prompt and contains the words `playwright` / `vitest` / `tsdown`):

```
3748915 /home/zlx/.local/bin/cursor-agent ... dlg-20260830-1716...[argv_len=8417]
3975877 /usr/bin/zsh -c ...[argv_len=1595]
3976434 /usr/bin/zsh -c ...[argv_len=1595]
```

Count before filter: 3.

After dropping lines that contain `cursor-agent` or `dlg-20260830-171606-de18bc`: **empty**. No leftover Playwright / Vitest / tsdown process. The two zsh PIDs are this idle-check wrapper (their argv includes the `pgrep` pattern).

## Round 1 (trace on)

- Start: `2026-08-31T01:19:34+08:00`
- Wall clock: `WALL_SECONDS=137.29` (`/usr/bin/time`)
- JSON stats: `expected=101 skipped=8 unexpected=7 flaky=0` (116 rows)
- Status mix: `passed=101 skipped=8 timedOut=6 failed=1`
- By project: chromium `timedOut=6`; webkit `failed=1` (reconnect-banner assertion; out of scope)

Of the 6 chromium `timedOut` rows, **4 are `page.goto` still waiting when the 30 s suite timeout fires**. None of those 4 contain `while setting up "serve"`. The other 2 are body timeouts after a completed first navigation (contrast section).

Serve fixture in the 4 goto-hang traces finished in ~0.8 s (`test.trace` `Fixture "serve"` after-event). The hang is after HTTP serve is up.

## Evidence group 1 — `keyboard-toggle.spec.ts` beforeEach, waiting until `load`

- **Spec / line:** `tests/playwright/keyboard-toggle.spec.ts` test at line 75 (`send button produces a WS input payload while the keyboard is suppressed`); hang is the shared `beforeEach` at line 17 `page.goto('/')`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30140` ms, start `2026-08-30T17:19:44.955Z`
- **Error first line (ANSI stripped):** `Test timeout of 30000ms exceeded while running "beforeEach" hook.`
- **Second error (goto, ANSI stripped):**

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:40113/", waiting until "load"
```

Stack points at `keyboard-toggle.spec.ts:17:13` (`await page.goto('/')`). Does **not** contain `while setting up "serve"`.

- **Trace:** `/tmp/herdweb-chromium-nav/r1/test-results/keyboard-toggle-send-butto-70a7a--the-keyboard-is-suppressed-chromium-android/trace.zip`
- **`test.trace`:** `Fixture "serve"` completed (`endTime=10822.259`); next API step is `Navigate to "/"` (`pw:api@29`); that call never gets a successful `after`. Error event: `page.goto: Test timeout of 30000ms exceeded.`
- **`0-trace.trace`:** `Frame.goto` `before` with `params.url="/" waitUntil="load" timeout=0` at monotonic `10877.962`. Log line: `navigating to "http://127.0.0.1:40113/", waiting until "load"`. No `after` for this call. Pre-goto snapshot `frameUrl=about:blank`.
- **Pending requests** (from `0-trace.network` HAR snapshots):
  1. `GET http://127.0.0.1:40113/` — **done**, `time=6.548` ms, HTTP 200, `mime=text/html; charset=UTF-8`, started `2026-08-30T17:19:45.850Z`
  2. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` — **pending**, HAR `time=-1`, response `status=-1`, `mimeType=x-unknown`, empty response headers, timings `send/wait/receive=-1`, started `2026-08-30T17:19:45.867Z` (17 ms after the document). Not `_failed` / not `_canceled`.
- **`DOMContentLoaded`:** no lifecycle event in the trace. `page.goto` never left `waiting until "load"`, so `load` did **not** fire. The document HTML itself had already returned (6.5 ms).
- **`load`:** not fired. Goto stayed on the single call-log line above until the suite timeout.

The captured HTML resource in the same zip (`resources/a6bbd445b2ecf44c699be4284495880fdf61afcb.html`, 527710 bytes) has this as the first `<head>` link:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css">
```

## Evidence group 2 — `target-badge-layout.spec.ts:41`, waiting until `domcontentloaded`

This row is the same hang, but the test already opted out of `load`:

- **Spec / line:** `tests/playwright/target-badge-layout.spec.ts` test at line 37; hang is line 41 `page.goto(serve.url, { waitUntil: 'domcontentloaded' })`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30189` ms, start `2026-08-30T17:19:57.462Z`
- **Error first line:** `Test timeout of 30000ms exceeded.`
- **Second error:**

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:33591/", waiting until "domcontentloaded"
```

Does **not** contain `while setting up "serve"`.

- **Trace:** `/tmp/herdweb-chromium-nav/r1/test-results/target-badge-layout-target-4531e-oice-composer-layer-is-open-chromium-android/trace.zip`
- **`0-trace.trace`:** `Frame.goto` `before` with `waitUntil="domcontentloaded"`, never completed.
- **Pending requests:**
  1. `GET http://127.0.0.1:33591/` — **done**, `time=11.86` ms, HTTP 200, `text/html`
  2. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` — **pending**, HAR `time=-1`, response `status=-1`
- **`DOMContentLoaded`:** did **not** fire (`goto` still waiting until `domcontentloaded` at timeout).
- **`load`:** did not fire (DCL is a predecessor).

Same first `<link rel="stylesheet">` in the captured HTML (`resources/9ade06495225dc1066ab91821223b643bcd48199.html`).

## Evidence group 3 — `weak-network.spec.ts:119`, waiting until `load`

- **Spec / line:** `tests/playwright/weak-network.spec.ts` test at line 114 (`offline keyboard input is dropped and recovery requires a fresh synced snapshot`); hang is line 119 `page.goto('/')`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30102` ms, start `2026-08-30T17:20:06.753Z`
- **Error first line:** `Test timeout of 30000ms exceeded.`
- **Second error:**

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:34715/", waiting until "load"
```

Does **not** contain `while setting up "serve"`.

- **Trace:** `/tmp/herdweb-chromium-nav/r1/test-results/weak-network-offline-keybo-cdba7-res-a-fresh-synced-snapshot-chromium-android/trace.zip`
- **Pending requests:**
  1. `GET http://127.0.0.1:34715/` — **done**, `time=5.571` ms, HTTP 200, `text/html`
  2. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` — **pending**, HAR `time=-1`, response `status=-1`
- **`DOMContentLoaded` / `load`:** neither recorded; goto never completed.

## Evidence group 4 — `weak-network.spec.ts:181`, waiting until `load`

Fourth independent spec/line (same file, different test). Same pending URL.

- **Spec / line:** `tests/playwright/weak-network.spec.ts` test at line 176 (`offline event invalidates an OPEN socket before keyboard input is sent`); hang is line 181 `page.goto('/')`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30073` ms, start `2026-08-30T17:20:41.837Z`
- **Error first line:** `Test timeout of 30000ms exceeded.`
- **Second error:**

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:35231/", waiting until "load"
```

Does **not** contain `while setting up "serve"`.

- **Trace:** `/tmp/herdweb-chromium-nav/r1/test-results/weak-network-offline-event-e6e9d-fore-keyboard-input-is-sent-chromium-android/trace.zip`
- **Pending requests:**
  1. `GET http://127.0.0.1:35231/` — **done**, `time=12.371` ms, HTTP 200, `text/html`
  2. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` — **pending**, HAR `time=-1`, response `status=-1`
- **`DOMContentLoaded` / `load`:** neither recorded; goto never completed.

## Contrast — chromium `timedOut` that is not a first-navigation hang

Round 1 also timed out:

| Spec | JSON duration | Why it is not counted as a goto-hang |
| --- | --- | --- |
| `mouse-encoding.spec.ts:14` | 30034 ms | First `page.goto` **completed** (`0-trace.trace` `after` at `5155.97`). Trace log then shows `#terminal .xterm` visible and `Expect "toContainText"`. Error is `Test timeout of 30000ms exceeded.` plus `browserContext.close: Test ended.` — not `page.goto: Test timeout`. Network: document + `sw.js` + the jsDelivr **CSS completed** (~559 ms); a later `JetBrainsMonoNerdFontMono-Regular.woff2` is still pending on one page. |
| `smoke.spec.ts:91` | 30233 ms | First client's goto completed; timeout hits `secondPage.goto('/')` at line 105 with `Error: page.goto: Test ended` (the test already used its 30 s elsewhere). Same CSS URL **completed** (~528 ms) on the first client; woff2 pending on one of the two pages. |

These two rows are 30 s suite timeouts, but they are not the candidate-1 signature (first `page.goto` stuck before `load`). They are recorded so they are not mixed into the pending-CSS claim.

WebKit `weak-network.spec.ts:247` failed (`toBeVisible` on the reconnect banner, 17030 ms). Out of scope (candidate 2).

## Shared fact across the four goto-hangs

At the moment Playwright is still inside `page.goto`:

- Local document request is finished in 5–12 ms (HTTP 200).
- Exactly one request is pending: `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css`.
- HAR `time=-1` / `status=-1` / empty response headers: the browser has **not** received a response (not a 4xx/5xx body, not a completed redirect).
- No other pending URL appears in those four network logs (no hung `/sw.js`, no hung WebSocket upgrade, no hung local JS — the client bundle is an inline `<script>`, not a separate request).

When the same CSS URL **does** complete in this suite, it takes ~500–560 ms (mouse-encoding / smoke contrast traces). The flake is the stall (`time=-1` through the remaining ~30 s), not that 500 ms cost.

## Observer effect

Round 1 was run with `--trace retain-on-failure`. Chromium navigation timeouts **reproduced** (4 goto-hangs + 2 other suite timeouts). Round 2 with the same flags reproduced two more goto-hangs (woff2 stage). Trace did not make candidate 1 disappear, so these traces are valid evidence for the hang, not a substitute borrowed from the no-trace baseline.

## Round 2

Same command as round 1 (`--trace retain-on-failure`). Start `2026-08-31T01:25:29+08:00`, `WALL_SECONDS=121.92 EXIT=1`. JSON: `expected=104 skipped=8 unexpected=4 flaky=0`. Status mix: `passed=104 timedOut=3 failed=1 skipped=8`. Chromium `timedOut=2`, both `page.goto` still waiting until `load`. Neither contains `while setting up "serve"`.

### Evidence group 5 — `asr.spec.ts:186`, waiting until `load` (CSS done, woff2 pending)

- **Spec / line:** `tests/playwright/asr.spec.ts` test at line 182 (`socket error followed by close emits one disconnected transition`); hang is line 186 `page.goto(serve.url)`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30207` ms
- **Error first line:** `Test timeout of 30000ms exceeded.`
- **Second error:** `Error: page.goto: Test timeout of 30000ms exceeded.` Call log: `navigating to "http://127.0.0.1:44567/", waiting until "load"`.
- **Trace:** `/tmp/herdweb-chromium-nav/r2/test-results/asr-Voice-composer-tap-to--e1220-one-disconnected-transition-chromium-android/trace.zip`
- **Pending requests:**
  1. `GET http://127.0.0.1:44567/` — **done**, `10.8` ms, 200
  2. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` — **done**, `539.0` ms, 200
  3. `GET http://127.0.0.1:44567/sw.js` — **done**, `24.6` ms, 200
  4. `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/fonts/JetBrainsMonoNerdFontMono-Regular.woff2` — **pending**, HAR `time=-1`, `status=-1`
- **`load`:** not fired (`goto` still waiting until `load`). CSS had already completed, so this is not the same pending row as groups 1–4.

### Evidence group 6 — `smoke.spec.ts:63`, waiting until `load` (same woff2)

- **Spec / line:** `tests/playwright/smoke.spec.ts` test at line 62 (`help overlay shows version`); hang is line 63 `page.goto('/')`.
- **Project:** `chromium-android`
- **JSON:** `status=timedOut` duration `30226` ms
- **Error first line:** `Test timeout of 30000ms exceeded.`
- **Second error:** `Error: page.goto: Test timeout of 30000ms exceeded.` Call log: `navigating to "http://127.0.0.1:43445/", waiting until "load"`.
- **Trace:** `/tmp/herdweb-chromium-nav/r2/test-results/smoke-help-overlay-shows-version-chromium-android/trace.zip`
- **Pending requests:** document `9.9` ms 200; `/sw.js` `20.5` ms 200; jsDelivr CSS `560.3` ms 200; **pending** the same `JetBrainsMonoNerdFontMono-Regular.woff2` (`time=-1`).
- **`load`:** not fired.

Round 2 also had a webkit `smoke.spec.ts:52` `page.goto` timeout (same call log, waiting until `load`) and the known webkit reconnect-banner `failed`. Out of scope; not opened here.

The woff2 URL is the Regular face declared by that CSS. A curl of the CSS during this session (`2026-08-30T17:28:45Z`, 1050 bytes, HTTP 200 in <1 s) shows four `@font-face` rules, relative `url("fonts/JetBrainsMonoNerdFontMono-Regular.woff2")`, **no `font-display`**. `local("JetBrainsMonoNerdFontMono-Regular")` is listed first; headless Chromium on this machine does not have that family, so it fetches.

## What is stuck

Two stages, one origin.

1. **Stylesheet stall (groups 1–4).** Document HTML returns in 5–12 ms. `page.goto` stays on `waiting until "load"` (group 2: `waiting until "domcontentloaded"`) because `GET https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css` never gets a response (`HAR time=-1`, `status=-1`, empty headers). Local `/sw.js` is not in those four network logs at all — the parser never got past the stylesheet to run the inline script that would register the SW.
2. **Font stall (groups 5–6).** The CSS **does** return (~540–560 ms). Then `GET …/fonts/JetBrainsMonoNerdFontMono-Regular.woff2` stays `time=-1`, and `waitUntil: 'load'` still does not complete.

Not claimed: “jsDelivr is down.” A curl of the CSS from this machine between the two rounds succeeded. The failure mode is an **individual browser request that never receives a response** while other tests in the same suite often get the same URL in ~500 ms.

`DOMContentLoaded` / `load` events are not present as Playwright `event` records in these traces (the library log only has `Frame.goto` + HAR). The waitUntil string on the still-open `goto` is the evidence that the named lifecycle event has not fired.

## Why `domcontentloaded` also waits (group 2)

`build.ts` `renderClientHtml` emits, in order:

1. `<head>`: `<link rel="stylesheet" href="{config.font.cdnUrl}">` (`cdnUrl` default in `src/config.ts` is the jsDelivr jetbrainsmono-nfm.css).
2. `<body>`: `#terminal-container`, then a **classic inline** `<script nonce=…>` with the whole client bundle (~500 KB). No `src`, no `type="module"`, no `defer`/`async`.

HTML: a classic script must wait for pending stylesheets before it runs. DCL waits for that script. So a hung stylesheet blocks **both** `DOMContentLoaded` and `load`. Switching tests to `waitUntil: 'domcontentloaded'` cannot fix groups 1–4; group 2 is already on DCL and still timed out on the same pending CSS.

After the CSS arrives, the script can run and DCL can fire. `load` can then still wait on the `@font-face` woff2 (groups 5–6). That is why group 2 (DCL) and groups 5–6 (`load` after CSS) are the same dependency, different stage.

Service worker is not the pending resource on any of the six goto-hang traces. When `/sw.js` appears, it finishes in 8–25 ms.

## Next-card candidates (do not do them here)

A repair card can pick **one** of these and re-run a JSON walk like `baseline.md` (not a single spec).

1. **Take the font off the document load path (product).** Stop emitting a render-blocking third-party `<link rel="stylesheet">` in `renderClientHtml`. Self-host the CSS+woff2, or inject the font after first paint (`media`/`onload`, or `font-display: optional` **plus** not blocking DCL on the CSS — `font-display` alone does not fix groups 1–4). **Red → green:** chromium rows that today die as `status=timedOut` at 30.0–30.3 s on `page.goto` should finish navigation; they will either pass or fail the 10 s `waitForSelector` as `status=failed`. The 10 s vs 30 s contrast in `baseline.md` is the check.
2. **Stub jsDelivr in Playwright (test isolation only).** Fulfill or abort `cdn.jsdelivr.net` in the fixture so e2e does not need the internet. This would green the suite without changing what a phone does on a bad CDN day. Do not treat it as a product fix for candidate 1.
3. **Not sufficient:** only changing `page.goto` to `waitUntil: 'domcontentloaded'` (group 2). **Not in scope:** raising `timeout`, enabling `retries`, single-spec loops, blaming `/sw.js`.

Suggested first repair: (1), because the HTML critical path currently requires a live jsDelivr GET before the client script may run. (2) is a valid e2e-hygiene follow-up so a future CDN stall cannot reopen issue #135 even if someone puts a CDN link back.
