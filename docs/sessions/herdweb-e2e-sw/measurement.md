# e2e Service Worker cost measurement (issue #62)

Recorded on 2026-08-30/31, worktree `herdweb-20260830-10`, base
`4c3918dba419485e73a80cad214b69d8e23126fe`.

Command for every counted round: `pnpm run test:pw` (both Playwright
projects, `retries: 0` because `CI` is unset). Wall-clock from
`/usr/bin/time -f 'WALL_SECONDS=%e'` wrapping that command; Playwright's
own `(Nm)` summary is also recorded.

**Conclusion: Service Worker is not the main e2e cost on this checkout.**
The fixture intercept was rolled back. This file is the only lasting
change.

## Current suite size (stale "86" baseline)

`pnpm exec playwright test --list` on this checkout:

```
Total: 116 tests in 15 files
```

Issue #62's "82 → 86" count is **stale**. This checkout lists 116 tests.
Eight of them are `test.skip` (not new skips introduced by this work):

- `asr.spec.ts`: 4 chromium-only voice-flow tests skip on webkit; 1
  webkit-only degradation test skips on chromium
- `notify.spec.ts`: 2 tests skip on webkit
- `dpad.spec.ts`: 1 clipboard test skips on webkit

Runnable per round = 116 − 8 = 108. Passed-count comparisons use the
measured 97–105 range, not the historical 86.

## Idle check (constraint 5)

Exact command `pgrep -fl 'playwright|vitest|tsdown'` immediately before
baseline round 1 (2026-08-30T23:30:49+08:00):

```
3793825 MainThread
```

PID 3793825 is this dispatch's `cursor-agent` process. Its argv contains
the task-card text (the words `playwright` / `vitest` / `tsdown`), so
`pgrep -f` matches it. Filtered to exclude `cursor-agent` / this dispatch
id:

```
FILTERED_EMPTY
```

The same filtered-empty result held at the start of the valid shielded
arm (2026-08-30T23:57:51+08:00). Rounds were serial; no `pnpm test` in
parallel.

## Assumption adjustment: `page.route` does not intercept `sw.js`

Locked decision 1 recommended `page.route('**/sw.js')` → 404. A probe
after wrapping the Playwright `page` fixture wrote zero hit logs for
`sw.js`, while `context.on('request')` and `context.route` both saw
`http://127.0.0.1:<port>/sw.js`. Chromium fetches the worker script
outside the page request pipeline.

An earlier three-round arm that used only `page.route` is therefore
**not a SW-off condition** (it was a no-op intercept). Those logs were
kept under `/tmp/herdweb-e2e-sw-measure/invalid-page-route/` and are
**not** part of the six counted rounds below.

The counted shielded arm uses `context.route('**/sw.js')` → 404, which
the probe confirmed intercepts the worker script. That is still
request-layer intercept (no product-code change). Extra pages created
via `browser.newContext()` / `browser.newPage()` are not covered by the
default `context` fixture; that is a handful of tests and cannot hide a
claimed +40% suite-level effect.

`src/client-entry.ts` `registerServiceWorker` is still try/catch wrapped
(lines 1255–1264); 404 does not hang the page. It **does**
`console.error('herdweb: service worker registration failed', ...)`.

## Baseline (Service Worker **not** blocked)

Same checkout, no fixture changes. Three full-suite rounds.

| Round | WALL_SECONDS | Playwright wall | passed | failed | skipped | exit |
| ----- | ------------ | --------------- | ------ | ------ | ------- | ---- |
| 1     | 98.16        | 1.6m            | 105    | 3      | 8       | 1    |
| 2     | 121.56       | 2.0m            | 100    | 8      | 8       | 1    |
| 3     | 106.88       | 1.8m            | 105    | 3      | 8       | 1    |

Mean wall 108.87s. Range 98.16–121.56s (**spread 23.40s**). Failed 3/8/3.

### Baseline round 1 tail

```
  3 failed
    [chromium-android] › tests/playwright/weak-network.spec.ts:369:2 › composer action weak network › offline before send keeps draft and emits no action frame
    [webkit-iphone] › tests/playwright/dpad.spec.ts:85:1 › holding → repeats the right-arrow sequence (300ms delay, 100ms interval)
    [webkit-iphone] › tests/playwright/weak-network.spec.ts:247:1 › killing the socket while hidden reconnects behind a banner that keeps the old screen
  8 skipped
  105 passed (1.6m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=98.16

### Baseline round 2 tail

```
  8 failed
    [chromium-android] › tests/playwright/keyboard-toggle.spec.ts:41:1 › locking while focused blurs the textarea first
    [chromium-android] › tests/playwright/notify.spec.ts:23:1 › notify panel subscribes, receives test push, and focuses on click
    [chromium-android] › tests/playwright/prefix.spec.ts:47:1 › prefix combo picker cancel restores default title
    [chromium-android] › tests/playwright/smoke.spec.ts:29:1 › terminal accepts keyboard input after tapping the screen
    [chromium-android] › tests/playwright/target-switch.spec.ts:15:2 › explicit target picker (T5) › desktop browser shows badge and picker in explicit mode
    [webkit-iphone] › tests/playwright/smoke.spec.ts:91:1 › late client receives terminal snapshot
    [webkit-iphone] › tests/playwright/target-switch.spec.ts:48:2 › explicit target picker (T5) › badge reflects the current target and the picker switches targets
    [webkit-iphone] › tests/playwright/weak-network.spec.ts:140:1 › offline and online recovery converges to the server snapshot
  8 skipped
  100 passed (2.0m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=121.56

### Baseline round 3 tail

```
  3 failed
    [chromium-android] › tests/playwright/mouse-encoding.spec.ts:14:1 › late client taps produce SGR mouse reports
    [chromium-android] › tests/playwright/session-exit.spec.ts:32:2 › session exit with reconnect › ended command closes the session and shows reconnect overlay
    [webkit-iphone] › tests/playwright/weak-network.spec.ts:247:1 › killing the socket while hidden reconnects behind a banner that keeps the old screen
  8 skipped
  105 passed (1.8m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=106.88

## Shielded (Service Worker blocked via `context.route`)

Fixture: default `context.route('**/sw.js')` fulfill 404. `notify.spec.ts`
does not import `./fixtures`, so its two chromium tests still register a
real worker (2 of 108 runnable tests).

| Round | WALL_SECONDS | Playwright wall | passed | failed | skipped | exit |
| ----- | ------------ | --------------- | ------ | ------ | ------- | ---- |
| 1     | 128.83       | 2.1m            | 99     | 9      | 8       | 1    |
| 2     | 105.65       | 1.7m            | 101    | 7      | 8       | 1    |
| 3     | 131.31       | 2.2m            | 97     | 11     | 8       | 1    |

Mean wall 121.93s. Range 105.65–131.31s (spread 25.66s). Failed 9/7/11.

### Shielded round 1 tail

```
  9 failed
    [chromium-android] › tests/playwright/keyboard-toggle.spec.ts:60:1 › onFocusChange fires on real textarea focus and blur
    [chromium-android] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [chromium-android] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
    [chromium-android] › tests/playwright/weak-network.spec.ts:321:2 › composer action weak network › lost accepted retries the same action once and writes PTY once
    [webkit-iphone] › tests/playwright/dpad.spec.ts:75:1 › holding ⏎ sends \n (0a) and never \r (0d)
    [webkit-iphone] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [webkit-iphone] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
    [webkit-iphone] › tests/playwright/target-switch.spec.ts:48:2 › explicit target picker (T5) › badge reflects the current target and the picker switches targets
    [webkit-iphone] › tests/playwright/weak-network.spec.ts:114:1 › offline keyboard input is dropped and recovery requires a fresh synced snapshot
  8 skipped
  99 passed (2.1m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=128.83

### Shielded round 2 tail

```
  7 failed
    [chromium-android] › tests/playwright/notify.spec.ts:23:1 › notify panel subscribes, receives test push, and focuses on click
    [chromium-android] › tests/playwright/prefix.spec.ts:23:1 › prefix button tap opens combo picker with contextual title
    [chromium-android] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [chromium-android] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
    [webkit-iphone] › tests/playwright/image-drop.spec.ts:34:3 › image drop base path /herdweb › image drop inserts path into PTY without Enter
    [webkit-iphone] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [webkit-iphone] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
  8 skipped
  101 passed (1.7m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=105.65

### Shielded round 3 tail

```
  11 failed
    [chromium-android] › tests/playwright/asr.spec.ts:162:2 › Voice composer tap-to-toggle input › connection observer replays a disconnected state to late subscribers
    [chromium-android] › tests/playwright/keyboard-toggle.spec.ts:75:1 › send button produces a WS input payload while the keyboard is suppressed
    [chromium-android] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [chromium-android] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
    [chromium-android] › tests/playwright/smoke.spec.ts:52:1 › no floating controls overlay the terminal content
    [chromium-android] › tests/playwright/touch.spec.ts:20:1 › drawer toggle responds to touchend-only (no click)
    [chromium-android] › tests/playwright/weak-network.spec.ts:114:1 › offline keyboard input is dropped and recovery requires a fresh synced snapshot
    [chromium-android] › tests/playwright/weak-network.spec.ts:247:1 › killing the socket while hidden reconnects behind a banner that keeps the old screen
    [webkit-iphone] › tests/playwright/dpad.spec.ts:75:1 › holding ⏎ sends \n (0a) and never \r (0d)
    [webkit-iphone] › tests/playwright/proxy.spec.ts:131:1 › reverse-proxied subpath access uses request-scoped CSP and a live websocket
    [webkit-iphone] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
  8 skipped
  97 passed (2.2m)
[ELIFECYCLE] Command failed with exit code 1.
```

WALL_SECONDS=131.31

## Comparison (what exceeds round-to-round spread)

Baseline spread is the noise floor: **23.40s**.

| Metric              | Baseline           | Shielded (real block) | Delta vs baseline      | Exceeds spread? |
| ------------------- | ------------------ | --------------------- | ---------------------- | --------------- |
| Mean wall           | 108.87s            | 121.93s               | **+13.06s (slower)**   | No (13 < 23)    |
| Wall range          | 98.16–121.56s      | 105.65–131.31s        | overlap almost total   | No              |
| Failed per round    | 3 / 8 / 3          | 9 / 7 / 11            | **more failures**      | Direction wrong |
| Skipped             | 8 / 8 / 8          | 8 / 8 / 8             | none                   | —               |
| Passed              | 105 / 100 / 105    | 99 / 101 / 97         | lower (new failures)   | —               |

A claimed +40% SW cost would be ~44s off a 109s mean. The observed
shielded mean moved **the other way** by 13s, inside the 23s baseline
spread. Failures did not drop.

### Deterministic new failure caused by the intercept

`smoke.spec.ts:10` "loads without console errors" failed on **both
projects in all three shielded rounds**. It never failed in the three
baseline rounds. Assertion body (shielded round 3, chromium):

```
Expected: Array []
Received: Array [
  "A bad HTTP response code (404) was received when fetching the script.",
  "herdweb: service worker registration failed TypeError: Failed to register a ServiceWorker ... A bad HTTP response code (404) was received when fetching the script.",
]
```

That is `src/client-entry.ts` logging the caught registration error.
Landing a default-404 would require either changing product code
(forbidden) or relaxing this smoke assertion (forbidden).
`proxy.spec.ts:131` also failed on both projects in all three shielded
rounds and in **zero** baseline rounds — a second consistent
regression of the intercept, not diagnosed further because this card
does not land.

Other failures (weak-network overlay already `Synced`, dpad hold
timing, keyboard-toggle, session-exit, asr, target-switch) appear in
**both** arms and rotate spec names — ordinary flake, not SW-specific.

## Specs that actually need a Service Worker (read, not guessed)

Only `tests/playwright/notify.spec.ts` talks to `navigator.serviceWorker`.
It imports `test` from `@playwright/test`, **not** `./fixtures`, and
starts its own `startIsolatedServe({ isolateTmpDir: false })`.

| Test | Why SW is required |
| ---- | ------------------ |
| `notify panel subscribes, receives test push, and focuses on click` | Explicit `navigator.serviceWorker.register('/sw.js')` then `ready` before subscribe/push fetches. Chromium-only (`test.skip` on webkit). |
| `notify toggle tap subscribes via touch and persists state on reopen` | Same explicit register/ready. Panel `refreshToggle` / `subscribe` call `getRegistration()` which polls `navigator.serviceWorker.getRegistration(basePath)` until `registration.active` (`src/controls/notify-panel.ts` 266–314). Without an active worker the toggle stays disabled with "Service worker unavailable or timed out". Chromium-only. |

`notify-panel.ts:506` (button "重新注册 Service Worker") is not clicked
by either test; coverage of that path is the explicit `register('/sw.js')`
in the spec plus the client-entry auto-register. No other spec file
references `serviceWorker` or `sw.js`.

If this card had landed, only `notify.spec.ts` would opt in — and it
already bypasses the fixture, so it would keep SW without `test.use`.
That is moot: we did not land.

## Other candidates (not SW)

1. **Suite growth, not SW install.** Issue #62 compared 82 vs 86 tests.
   This checkout lists **116**. Wall 1.6–2.0m matches the issue's
   post-SW band without needing a per-test SW tax.
2. **Timeout-shaped flake inflates wall clock.** Several failures sit
   at 30.1s (`timeout: 30_000`). Baseline round 2 (8 failed, 121.56s)
   and shielded round 3 (11 failed, 131.31s) are the slow rounds.
   Issue #51 hang / overlay already-`Synced` (`weak-network.spec.ts:247`)
   showed up in baseline rounds 1 and 3 with SW still on.
3. **`page.route` cannot be the landing form even if someone later
   disagrees about cost.** It does not intercept the worker script
   fetch. `context.route` does, and it makes smoke/proxy worse.

## Landing decision

**Do not land.** Fixture intercept reverted (`git restore` of
`tests/playwright/fixtures.ts`). Only this document remains.
