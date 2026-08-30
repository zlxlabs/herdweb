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
