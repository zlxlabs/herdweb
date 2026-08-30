# e2e flake baseline (issue #135)

Recorded 2026-08-31 on worktree `herdweb-20260831-01`, base `6725c71e8f7c6658640ba4bc5db173cacb0e5780` (`main`).

Ten serial full-suite runs, both Playwright projects (`chromium-android`, `webkit-iphone`), `retries: 0` (`CI` unset). Command for every counted round:

```bash
pnpm exec playwright test --reporter=json > /tmp/herdweb-e2e-flake-20260831/round-N.json
```

Wall-clock from `/usr/bin/time -f 'WALL_SECONDS=%e'` wrapping that command. Counts below are walked from the JSON reporter (`suites[].specs[].tests[].results[]`), not from terminal summary text. `passed` / `failed` / `skipped` use JSON `status` (`passed` / `failed`|`timedOut` / `skipped`). A `(test, project)` pair is one row: the same spec on chromium and webkit is two rows.

Raw JSON stays in `/tmp/herdweb-e2e-flake-20260831/` and is not committed.

## Suite size

`pnpm exec playwright test --list` on this checkout:

```
Total: 116 tests in 15 files
```

Eight of those are existing `test.skip` (asr chromium/webkit mutex 5, notify webkit 2, dpad clipboard webkit 1). Runnable per round = 108. Every round below walked 116 results with skipped=8.

## Idle check

Immediately before round 1, 2026-08-31T00:29:53+08:00.

Unfiltered `pgrep -fl 'playwright|vitest|tsdown'`:

```
219619 zsh
220506 zsh
4157934 MainThread
```

Unfiltered `pgrep -af 'playwright|vitest|tsdown'` hit the same three PIDs: two `zsh -c` wrappers of this idle-check command (argv contains the task-card words), and PID 4157934 `cursor-agent` whose argv is the task card (includes `playwright` / `vitest` / `tsdown` and dispatch id `dlg-20260830-162705-6e50bb`).

After dropping lines that contain `cursor-agent` or `dlg-20260830-162705`:

```
FILTERED_EMPTY
```

No other Playwright / vitest / tsdown worker was running. Rounds were serial; `pnpm test` was not started until after all ten JSON files were on disk.

## Per-round counts

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | JSON `timedOut` | JSON `stats.unexpected` |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `/tmp/herdweb-e2e-flake-20260831/round-1.json` | 151430 | 118.83 | 104 | 4 | 8 | 4 | 4 |
| 2 | `/tmp/herdweb-e2e-flake-20260831/round-2.json` | 154843 | 124.56 | 104 | 4 | 8 | 3 | 4 |
| 3 | `/tmp/herdweb-e2e-flake-20260831/round-3.json` | 171912 | 150.43 | 97 | 11 | 8 | 9 | 11 |
| 4 | `/tmp/herdweb-e2e-flake-20260831/round-4.json` | 153621 | 165.57 | 104 | 4 | 8 | 3 | 4 |
| 5 | `/tmp/herdweb-e2e-flake-20260831/round-5.json` | 150857 | 107.14 | 105 | 3 | 8 | 2 | 3 |
| 6 | `/tmp/herdweb-e2e-flake-20260831/round-6.json` | 178604 | 116.96 | 103 | 5 | 8 | 2 | 5 |
| 7 | `/tmp/herdweb-e2e-flake-20260831/round-7.json` | 175491 | 117.76 | 104 | 4 | 8 | 1 | 4 |
| 8 | `/tmp/herdweb-e2e-flake-20260831/round-8.json` | 147417 | 109.48 | 107 | 1 | 8 | 1 | 1 |
| 9 | `/tmp/herdweb-e2e-flake-20260831/round-9.json` | 151284 | 114.08 | 104 | 4 | 8 | 4 | 4 |
| 10 | `/tmp/herdweb-e2e-flake-20260831/round-10.json` | 152062 | 126.44 | 105 | 3 | 8 | 3 | 3 |

Failed-count sequence: **4 / 4 / 11 / 4 / 3 / 5 / 4 / 1 / 4 / 3**. No clean round. Playwright JSON `stats.unexpected` matches walked `failed` in every round.

## Every (test, project) that failed at least once

Rows: **34**. Distinct failing (test, project) combinations across the ten JSON files: **34**. These two numbers are the same; the table is complete, not a top-N cut.

| red/10 | project | spec | title | fail rounds | JSON status on fail | fail dur med (ms) | pass dur med (ms) |
| ---: | --- | --- | --- | --- | --- | ---: | ---: |
| 3/10 | webkit-iphone | weak-network.spec.ts:247 | killing the socket while hidden reconnects behind a banner that keeps the old screen | 4,6,7 | failed | 7237 | 2557 |
| 2/10 | chromium-android | smoke.spec.ts:91 | late client receives terminal snapshot | 2,4 | timedOut | 30142 | 3734 |
| 2/10 | chromium-android | touch.spec.ts:53 | backdrop responds to touchend-only | 9,10 | timedOut | 30190 | 2694 |
| 2/10 | chromium-android | weak-network.spec.ts:106 | plain page load constructs exactly one terminal WebSocket | 3,9 | timedOut | 30144 | 2690 |
| 2/10 | chromium-android | weak-network.spec.ts:321 | lost accepted retries the same action once and writes PTY once | 4,5 | timedOut | 30128 | 18331 |
| 2/10 | webkit-iphone | dpad.spec.ts:66 | tap ↓ sends the down-arrow sequence | 2,3 | failed | 7772 | 3129 |
| 2/10 | webkit-iphone | dpad.spec.ts:75 | holding ⏎ sends \n (0a) and never \r (0d) | 3,5 | failed | 8694 | 3416 |
| 2/10 | webkit-iphone | weak-network.spec.ts:140 | offline and online recovery converges to the server snapshot | 6,7 | failed | 7416 | 3635 |
| 1/10 | chromium-android | asr.spec.ts:36 | fake microphone → mock partial/final → PTY receives sanitized command bytes | 7 | timedOut | 30250 | 9053 |
| 1/10 | chromium-android | asr.spec.ts:162 | connection observer replays a disconnected state to late subscribers | 1 | timedOut | 30121 | 2559 |
| 1/10 | chromium-android | dpad.spec.ts:75 | holding ⏎ sends \n (0a) and never \r (0d) | 10 | timedOut | 30149 | 3189 |
| 1/10 | chromium-android | dpad.spec.ts:99 | 📋 pastes clipboard text into the terminal | 2 | timedOut | 30155 | 2589 |
| 1/10 | chromium-android | keyboard-toggle.spec.ts:22 | setKeyboardSuppressed toggles inputmode="none" on the real textarea | 3 | timedOut | 30071 | 2958 |
| 1/10 | chromium-android | keyboard-toggle.spec.ts:60 | onFocusChange fires on real textarea focus and blur | 3 | timedOut | 30122 | 2687 |
| 1/10 | chromium-android | keyboard-toggle.spec.ts:75 | send button produces a WS input payload while the keyboard is suppressed | 3 | timedOut | 30167 | 2323 |
| 1/10 | chromium-android | mouse-encoding.spec.ts:14 | late client taps produce SGR mouse reports | 8 | timedOut | 30038 | 4410 |
| 1/10 | chromium-android | multi-client.spec.ts:3 | two live clients stay in sync after alternating resizes | 3 | timedOut | 60053 | 4707 |
| 1/10 | chromium-android | prefix.spec.ts:33 | prefix combo picker submits follow-up key and closes | 6 | timedOut | 30235 | 2948 |
| 1/10 | chromium-android | proxy.spec.ts:131 | reverse-proxied subpath access uses request-scoped CSP and a live websocket | 1 | timedOut | 30014 | 2563 |
| 1/10 | chromium-android | session-exit.spec.ts:32 | ended command closes the session and shows reconnect overlay | 3 | timedOut | 30103 | 2582 |
| 1/10 | chromium-android | session-exit.spec.ts:54 | ended command shows a status overlay when reconnect is disabled | 10 | timedOut | 30161 | 2704 |
| 1/10 | chromium-android | smoke.spec.ts:3 | serves the herdweb terminal client | 9 | timedOut | 30190 | 2346 |
| 1/10 | chromium-android | smoke.spec.ts:10 | loads without console errors | 9 | timedOut | 30103 | 2906 |
| 1/10 | chromium-android | target-switch.spec.ts:82 | single mode renders no target badge | 3 | timedOut | 30108 | 2399 |
| 1/10 | chromium-android | touch.spec.ts:20 | drawer toggle responds to touchend-only (no click) | 1 | timedOut | 30177 | 2604 |
| 1/10 | chromium-android | touch.spec.ts:68 | drawer open → close → re-open cycle | 3 | timedOut | 30124 | 2825 |
| 1/10 | chromium-android | touch.spec.ts:127 | guide button responds to touchend-only | 2 | timedOut | 30126 | 2809 |
| 1/10 | chromium-android | weak-network.spec.ts:114 | offline keyboard input is dropped and recovery requires a fresh synced snapshot | 1 | timedOut | 30114 | 2992 |
| 1/10 | chromium-android | weak-network.spec.ts:292 | freeze and resume events force a fresh epoch and snapshot | 6 | timedOut | 30065 | 2847 |
| 1/10 | webkit-iphone | session-exit.spec.ts:32 | ended command closes the session and shows reconnect overlay | 3 | timedOut | 30117 | 3120 |
| 1/10 | webkit-iphone | smoke.spec.ts:91 | late client receives terminal snapshot | 5 | timedOut | 30102 | 4313 |
| 1/10 | webkit-iphone | target-switch.spec.ts:48 | badge reflects the current target and the picker switches targets | 6 | failed | 3020 | 3690 |
| 1/10 | webkit-iphone | weak-network.spec.ts:216 | brief hidden then visible reuses the live socket without attach-target | 7 | failed | 12282 | 12474 |
| 1/10 | webkit-iphone | weak-network.spec.ts:278 | first load shows a fullscreen modal overlay before the first snapshot | 4 | timedOut | 30139 | 2310 |

`fail dur med` / `pass dur med` are medians of JSON `results[].duration` on failing vs passing rounds for that row. `JSON status on fail` is `results[].status` (`timedOut` vs `failed`); skipped-only rounds do not appear.

Highest red rate in this baseline is **3/10** (`webkit-iphone` `weak-network.spec.ts:247`). Twenty-six of the 34 rows are 1/10. Chromium accounts for 25 rows, webkit 9.

## Failure modes (by how they died)

Grouping uses JSON `results[].status`, `results[].duration`, and the first line of `results[].errors[0].message` (ANSI codes stripped). Not grouped by spec filename.

| Kind | Rule | Instances (of 43) | Combos (of 34) |
| --- | --- | ---: | ---: |
| (a) suite timeout filled | `status=timedOut` and duration ≥ 29_000 ms | 32 | 28 |
| (b) assertion mismatch | `status=failed` and error starts with `expect(` | 11 | 6 |
| (c) connection / protocol | WS close, `page.goto` net::ERR, console error as the *reported* failure | 0 | 0 |

Every round had at least one (a). Kind (c) did not appear as the JSON error; `smoke.spec.ts:10` ("loads without console errors") died as (a) at 30.1 s, not as a console-error assertion.

### (a) suite timeout — 32 instances, four error first-lines

All 32 have duration 30_014–30_253 ms except `multi-client.spec.ts:3` (60_053 ms, that spec calls `test.setTimeout(60_000)`).

| Suffix of `errors[0].message` | Instances | Meaning |
| --- | ---: | --- |
| `Test timeout of 30000ms exceeded while running "beforeEach" hook.` | 11 | died in spec `test.beforeEach`, not in the test body |
| `Test timeout of 30000ms exceeded while setting up "serve".` | 1 | died in the `serve` fixture (`tests/playwright/fixtures.ts` → `startIsolatedServe`) |
| `Test timeout of 30000ms exceeded.` (no suffix) | 19 | died in the test body |
| `Test timeout of 60000ms exceeded.` | 1 | `multi-client.spec.ts:3` body |

The 11 beforeEach timeouts are all `chromium-android`, all in the four specs that define `test.beforeEach` (`touch.spec.ts` 5, `keyboard-toggle.spec.ts` 3, `dpad.spec.ts` 2, `prefix.spec.ts` 1). Those hooks start with `page.goto('/')` then `waitForSelector(..., { timeout: 10_000 })`. A selector miss would have been `status=failed` around 10 s with a `waitForSelector` error. The observed 30.1 s `timedOut` means `page.goto` (navigation timeout = suite timeout) did not finish.

`waitForHttp` in `isolated-serve.ts` is also 30_000 ms, which is why the one `serve` fixture death has the same duration.

`weak-network.spec.ts:321` (chromium, 2/10, body timeout, pass median 18_331 ms) is a budget special case: the test body contains `await page.waitForTimeout(15_000)` inside the 30 s cap. It is listed with (a) because JSON says `timedOut` at 30.1 s; it is not evidence of a hung `page.goto`.

### (b) assertion mismatch — 11 instances, all `webkit-iphone`

| Combo | red/10 | JSON duration med | What `errors[0].message` received vs expected |
| --- | ---: | ---: | --- |
| `weak-network.spec.ts:247` | 3/10 | 7237 | locator `#herdweb-reconnect-overlay` expected `/Reconnecting\|Syncing\|Disconnected/`; received `"SyncedRetry nowRe-authenticate"`; element had `data-connection-state="synced"` (9 locator samples) |
| `dpad.spec.ts:66` | 2/10 | 7772 | `expect.poll(screenText).toContain('1b5b42')`; received the bash `byte-ready` prompt only; call log `Timeout 5000ms exceeded while waiting on the predicate` |
| `dpad.spec.ts:75` | 2/10 | 8694 | same poll, expected `'0a'`; received the same `byte-ready` prompt only |
| `weak-network.spec.ts:140` | 2/10 | 7416 | `locator('body')` expected `normal-keyboard-<ts>`; received screen still showing `fresh-snapshot-<ts>` plus overlay text `SyncedRetry nowRe-authenticate`; Playwright `Timeout: 5000ms` |
| `target-switch.spec.ts:48` | 1/10 | 3020 | `expect(page.url()).toContain('target=two')`; received `http://127.0.0.1:42851/?target=one` |
| `weak-network.spec.ts:216` | 1/10 | 12282 | `getSocketConstructs(page)` expected `1` received `2` |

No chromium row has `status=failed`. Chromium only dies by filling the suite timeout.

## What to repair first

Must-fix is not a 5/10 hotspot — there isn't one. Highest cell is 3/10. The funnel is still dead because **every round is dirty** (1–11 failures) and **32 of 43 deaths are kind (a)**. Fixing kind (a) is the only change that can make a clean local `test:pw` round a realistic gate. Kind (b) is smaller, concentrated on webkit, and already has received-vs-expected text.

Suggested order: candidate 1 (chromium navigation timeout) → candidate 2 (webkit overlay already `synced`) → candidate 3 (webkit d-pad bytes never appear). Verify a repair with another 10-round JSON walk: kind (a) instance count should drop; do not treat a single green `test:pw` as success.

## Root-cause candidates

None of these were verified in this card. They are the narrowest readings that the 10-round JSON actually supports.

### 1. Chromium `page.goto` never reaches load, so the 30 s suite timeout fires

- **Tests:** the 11 `beforeEach` timeouts (`touch.spec.ts:20 :53 :68 :127`, `keyboard-toggle.spec.ts:22 :60 :75`, `dpad.spec.ts:75 :99`, `prefix.spec.ts:33`) plus body-timeout rows whose first navigation is `page.goto` / `page.goto(serve.url)` and whose next wait is shorter than 30 s (`smoke.spec.ts:3 :10 :91` on both projects, `session-exit.spec.ts:32` on both projects and `:54` chromium, `target-switch.spec.ts:82`, `weak-network.spec.ts:106 :114 :292 :278`, `asr.spec.ts:36 :162`, `mouse-encoding.spec.ts:14`). Shared fixture: `tests/playwright/fixtures.ts` `serve` → `startIsolatedServe`.
- **Shared path:** isolated `herdweb serve` on a random port, then `page.goto`. The four beforeEach specs all wait on `#wt-toolbar` / `.xterm` with a 10 s selector timeout *after* goto. WebKit shows the same 30 s `timedOut` death, just fewer cells (`smoke.spec.ts:91`, `session-exit.spec.ts:32`, `weak-network.spec.ts:278`).
- **Evidence:** JSON `status=timedOut`, duration 30.0–30.3 s, error first line is either `… while running "beforeEach" hook.` or bare `Test timeout of 30000ms exceeded.` Passing rounds of the same rows finish in 2.3–4.4 s (median). Inner waits that *do* have a shorter timeout (`waitForSelector` 10 s, `waitForSynced` `expect.poll` 15 s) would have produced `status=failed` with those errors; **zero chromium failures in this baseline are `status=failed`**. Round 3 clustered three `keyboard-toggle` beforeEach timeouts plus `touch.spec.ts:68` in the same round — same death, several specs.

### 2. WebKit reconnect banner is already `synced` when the test still asserts reconnecting text

- **Tests:** `weak-network.spec.ts:247` on `webkit-iphone` (3/10, highest cell). Related same-file webkit assertions: `:140` (2/10, keyboard marker missing while overlay text already contains `SyncedRetry nowRe-authenticate`) and `:216` (1/10, socket construct count 1→2 after hidden/visible).
- **Shared path:** `tests/playwright/weak-network.spec.ts` `installSocketProbe` + `setPageVisibility` + `context.setOffline` + `WebSocket.close()`, then `#herdweb-reconnect-overlay`.
- **Evidence:** all three `:247` failures are identical. `toBeVisible({ timeout: 15_000 })` and `data-layout=banner` passed; `toContainText(/Reconnecting|Syncing|Disconnected/)` failed at 5 s. Call log: locator resolved 9 times to `<div data-layout="banner" id="herdweb-reconnect-overlay" data-connection-state="synced">`, received string `"SyncedRetry nowRe-authenticate"`. Duration 7.1–8.1 s. Chromium never failed this spec in these 10 rounds.

### 3. WebKit d-pad tap/hold does not print the expected PTY hex; the screen stays on `byte-ready`

- **Tests:** `dpad.spec.ts:66` (↓ → `1b5b42`) 2/10 and `:75` (hold ⏎ → `0a`) 2/10, both `webkit-iphone`.
- **Shared path:** `startByteEcho` in `dpad.spec.ts` (PTY `stty -echo -icrnl` + bash read loop printing `%02x`) then `expect.poll(() => screenText(page)).toContain(...)`.
- **Evidence:** four failures, two rounds overlapping (`:66` rounds 2–3, `:75` rounds 3 and 5). Expected substring `"1b5b42"` or `"0a"`; received string is the typed bash command plus `byte-ready ` and nothing after. Call log: `Timeout 5000ms exceeded while waiting on the predicate`. Duration 7.6–8.8 s (`status=failed`, not `timedOut`). Chromium `:66` never failed; chromium `:75` failed once as a beforeEach 30 s timeout (candidate 1), not as a missing-hex assertion.

## Next cards (do not do them here)

- Capture a Chromium trace/HAR on one (a) death to see whether `page.goto` is waiting on document `load`, on the terminal WS, or on `waitForHttp` inside `serve`. Then change **one** thing and re-run 10 JSON rounds; success is kind (a) instance count falling, not a single green run.
- For `:247`, assert `data-connection-state` (the attribute the call log already shows) or wait for a reconnecting state *before* `synced`, instead of matching overlay copy. Re-check the 3/10 cell.
- For d-pad webkit, log `screenText` + PTY bytes on failure; the received prompt proves the echo loop started and the key did not.
- `weak-network.spec.ts:321` has a 15 s `waitForTimeout` inside a 30 s cap (pass median 18 s). Treat as a test-budget bug, not as evidence for candidate 1.
- Do not raise `timeout`, do not set local `retries`, do not `test.skip`. Those are issue #135 non-goals.

`target-switch.spec.ts:48` (URL still `target=one` after clicking `two`, 1/10 webkit) is a real assertion with a received value, but a single cell. Leave it until the three candidates above have repair cards.
