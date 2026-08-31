# e2e remeasure after candidates 1 and 2

Recorded 2026-08-31 on worktree `e2e-remeasure`, base `19f1c7101515070d21257b8ad0122cd62598ba30` (`origin/main`). Candidate 1 (chromium navigation blocked by font CSS) is in via PR #139. Candidate 2 (WebKit reconnect banner) is in via PR #140. Candidate 3 (webkit `dpad.spec.ts:75`) is **not** repaired.

Ten serial full-suite runs, both Playwright projects (`chromium-android`, `webkit-iphone`), `retries: 0` (`CI` unset). Command for every counted round:

```bash
pnpm exec playwright test --reporter=json > /tmp/herdweb-e2e-remeasure-20260831/round-N.json
```

Each round was wrapped in `/usr/bin/time -f 'WALL_SECONDS=%e'` and launched with `env -u CI` because the delegate shell inherited `CI=true` (which would have turned on `retries: 2` in `playwright.config.ts`). Evidence that retries stayed off: every JSON result has `retry: 0` (1180 results). Counts below are walked from the JSON reporter (`suites[].specs[].tests[].results[]`), not from terminal summary text. `passed` / `failed` / `skipped` use JSON `status` (`passed` / `failed`|`timedOut` / `skipped`). A `(test, project)` pair is one row: the same spec on chromium and webkit is two rows.

Raw JSON stays in `/tmp/herdweb-e2e-remeasure-20260831/` and is not committed.

This file does **not** replace `docs/sessions/herdweb-e2e-flake/baseline.md`.

## Suite size

`pnpm exec playwright test --list` on this checkout:

```
Total: 118 tests in 16 files
```

Baseline was 116 tests in 15 files. The extra file is `font-stylesheet.spec.ts` (candidate 1 regression guard); it passed on both projects in every round.

Eight of the 118 are existing `test.skip` (asr chromium/webkit mutex 5, notify webkit 2, dpad clipboard webkit 1). Runnable per round = 110. Every round below walked 118 results with skipped=8.

## Idle check

Immediately before round 1 setup, 2026-08-31T11:52:04+08:00. Round 1 itself started 2026-08-31T11:55:48+08:00 after `pnpm install` in this worktree.

Unfiltered `pgrep -af 'playwright|vitest|tsdown'`:

```
(empty)
```

Unfiltered `pgrep -fl 'playwright|vitest|tsdown'` was also empty.

After dropping lines that contain this dispatch id `dlg-20260831-035016-d94dc1` or the idle-check script path:

```
FILTERED_EMPTY
```

No other Playwright / vitest / tsdown worker was running. Rounds were serial. `pnpm test` was not started.

## Per-round counts

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | JSON `timedOut` | JSON `stats.unexpected` |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `/tmp/herdweb-e2e-remeasure-20260831/round-1.json` | 155954 | 103.47 | 106 | 4 | 8 | 3 | 4 |
| 2 | `/tmp/herdweb-e2e-remeasure-20260831/round-2.json` | 147834 | 100.74 | 109 | 1 | 8 | 1 | 1 |
| 3 | `/tmp/herdweb-e2e-remeasure-20260831/round-3.json` | 154868 | 88.04 | 107 | 3 | 8 | 2 | 3 |
| 4 | `/tmp/herdweb-e2e-remeasure-20260831/round-4.json` | 146115 | 79.89 | 110 | 0 | 8 | 0 | 0 |
| 5 | `/tmp/herdweb-e2e-remeasure-20260831/round-5.json` | 152673 | 95.46 | 108 | 2 | 8 | 1 | 2 |
| 6 | `/tmp/herdweb-e2e-remeasure-20260831/round-6.json` | 152823 | 80.34 | 107 | 3 | 8 | 2 | 3 |
| 7 | `/tmp/herdweb-e2e-remeasure-20260831/round-7.json` | 157177 | 82.50 | 106 | 4 | 8 | 3 | 4 |
| 8 | `/tmp/herdweb-e2e-remeasure-20260831/round-8.json` | 170999 | 90.01 | 107 | 3 | 8 | 2 | 3 |
| 9 | `/tmp/herdweb-e2e-remeasure-20260831/round-9.json` | 146121 | 68.35 | 110 | 0 | 8 | 0 | 0 |
| 10 | `/tmp/herdweb-e2e-remeasure-20260831/round-10.json` | 149393 | 69.48 | 109 | 1 | 8 | 0 | 1 |

Failed-count sequence: **4 / 1 / 3 / 0 / 2 / 3 / 4 / 3 / 0 / 1**. Dirty rounds: **8/10**. Clean rounds: 4 and 9. Playwright JSON `stats.unexpected` matches walked `failed` in every round.

Two green rounds do not restore the local funnel. The card rule still holds: do not treat a single (or even two) green `test:pw` as success.

## Every (test, project) that failed at least once

Rows: **17**. Distinct failing (test, project) combinations across the ten JSON files: **17**. These two numbers are the same; the table is complete, not a top-N cut.

| red/10 | project | spec | title | fail rounds | JSON status on fail | fail dur med (ms) | pass dur med (ms) |
| ---: | --- | --- | --- | --- | --- | ---: | ---: |
| 4/10 | webkit-iphone | target-switch.spec.ts:48 | badge reflects the current target and the picker switches targets | 1,6,7,10 | failed | 1500 | 2336 |
| 2/10 | webkit-iphone | dpad.spec.ts:75 | holding ⏎ sends \n (0a) and never \r (0d) | 3,5 | failed | 7042 | 2236 |
| 1/10 | chromium-android | asr.spec.ts:182 | socket error followed by close emits one disconnected transition | 8 | timedOut | 30141 | 1246 |
| 1/10 | chromium-android | dpad.spec.ts:111 | dragging the handle moves the pad, persists across reload, double-tap docks | 6 | timedOut | 30064 | 1938 |
| 1/10 | chromium-android | dpad.spec.ts:85 | holding → repeats the right-arrow sequence (300ms delay, 100ms interval) | 1 | timedOut | 30066 | 1917 |
| 1/10 | chromium-android | notify.spec.ts:112 | notify toggle tap subscribes via touch and persists state on reopen | 7 | timedOut | 30043 | 1604 |
| 1/10 | chromium-android | prefix.spec.ts:23 | prefix button tap opens combo picker with contextual title | 5 | timedOut | 30130 | 1529 |
| 1/10 | chromium-android | smoke.spec.ts:3 | serves the herdweb terminal client | 6 | timedOut | 30065 | 977 |
| 1/10 | chromium-android | smoke.spec.ts:52 | no floating controls overlay the terminal content | 8 | timedOut | 30160 | 1762 |
| 1/10 | chromium-android | smoke.spec.ts:62 | help overlay shows version | 3 | timedOut | 30170 | 1169 |
| 1/10 | chromium-android | touch.spec.ts:20 | drawer toggle responds to touchend-only (no click) | 3 | timedOut | 30166 | 1787 |
| 1/10 | chromium-android | touch.spec.ts:35 | drawer input button responds to touchstart + touchend | 7 | timedOut | 30053 | 1771 |
| 1/10 | chromium-android | touch.spec.ts:93 | synthesised click from tap() hits backdrop (regression guard) | 7 | timedOut | 30062 | 1377 |
| 1/10 | chromium-android | weak-network.spec.ts:394 | offline before send keeps draft and emits no action frame | 1 | timedOut | 30057 | 1343 |
| 1/10 | webkit-iphone | weak-network.spec.ts:114 | offline keyboard input is dropped and recovery requires a fresh synced snapshot | 1 | timedOut | 30099 | 1982 |
| 1/10 | webkit-iphone | weak-network.spec.ts:140 | offline and online recovery converges to the server snapshot | 8 | failed | 6435 | 2130 |
| 1/10 | webkit-iphone | weak-network.spec.ts:317 | freeze and resume events force a fresh epoch and snapshot | 2 | timedOut | 30091 | 1212 |

`fail dur med` / `pass dur med` are medians of JSON `results[].duration` on failing vs passing rounds for that row. `JSON status on fail` is `results[].status` (`timedOut` vs `failed`); skipped-only rounds do not appear.

Highest red rate in this remeasure is **4/10** (`webkit-iphone` `target-switch.spec.ts:48`). Fourteen of the 17 rows are 1/10. Chromium accounts for 12 rows, webkit 5.

Cells from the original `baseline.md` that did **not** fail here:

- `webkit-iphone` `weak-network.spec.ts:247` (candidate 2; was 3/10, now 0/10)
- `webkit-iphone` `dpad.spec.ts:66` (was 2/10, now 0/10)
- the many 1/10 chromium navigation rows that did not recur, replaced by a smaller 1/10 scatter

`webkit-iphone` `dpad.spec.ts:75` (candidate 3) is still **2/10**.

## Failure modes (by how they died)

Grouping uses JSON `results[].status`, `results[].duration`, and the first line of `results[].errors[0].message` (ANSI codes stripped). Not grouped by spec filename. Kind (b) also matches Playwright's `Error: expect(` prefix (the assertion still contains `expect(`).

| Kind | Rule | Instances (of 21) | Combos (of 17) |
| --- | --- | ---: | ---: |
| (a) suite timeout filled | `status=timedOut` and duration ≥ 29_000 ms | 14 | 14 |
| (b) assertion mismatch | `status=failed` and error contains `expect(` | 7 | 3 |
| (c) connection / protocol | WS close, `page.goto` net::ERR, console error as the *reported* failure | 0 | 0 |

Seven of ten rounds had at least one (a). Rounds 4 and 9 had none. Round 10 was dirty only from a kind (b) assertion. Kind (c) did not appear as the JSON error.

### (a) suite timeout — 14 instances, two error first-lines

All 14 have duration 30_043–30_170 ms. No 60 s `multi-client` timeout in this set.

| Suffix of `errors[0].message` | Instances | Meaning |
| --- | ---: | --- |
| `Test timeout of 30000ms exceeded while running "beforeEach" hook.` | 5 | died in spec `test.beforeEach`, not in the test body |
| `Test timeout of 30000ms exceeded.` (no suffix) | 9 | died in the test body |

The 5 beforeEach timeouts are all `chromium-android`, all in specs that define `test.beforeEach` (`touch.spec.ts` 3, `dpad.spec.ts` 1, `prefix.spec.ts` 1). Same death signature as `baseline.md` candidate 1: 30.1 s `timedOut`, which means `page.goto` did not finish inside the suite timeout.

Chromium still has **zero** `status=failed` rows. Chromium only dies by filling the suite timeout.

WebKit kind (a): two cells (`weak-network.spec.ts:114` and `:317`), both body timeouts at 30.1 s.

### (b) assertion mismatch — 7 instances, all `webkit-iphone`

| Combo | red/10 | JSON duration med | What `errors[0].message` received vs expected |
| --- | ---: | ---: | --- |
| `target-switch.spec.ts:48` | 4/10 | 1500 | `expect(page.url()).toContain('target=two')`; received `http://127.0.0.1:<port>/?target=one` on all four fails |
| `dpad.spec.ts:75` | 2/10 | 7042 | `expect.poll(screenText).toContain('0a')`; received the bash `byte-ready` prompt only; call log `Timeout 5000ms exceeded while waiting on the predicate` |
| `weak-network.spec.ts:140` | 1/10 | 6435 | `locator('body')` expected `normal-keyboard-<ts>`; received screen still showing `fresh-snapshot-<ts>` plus overlay text `SyncedRetry nowRe-authenticate`; Playwright `Timeout: 5000ms` |

No chromium row has `status=failed`.

## Versus `baseline.md`

| Metric | `baseline.md` | this remeasure |
| --- | --- | --- |
| Dirty rounds / 10 | **10/10** | **8/10** |
| Kind (a) instances | **32** | **14** |
| Kind (b) instances | 11 | 7 |
| Kind (c) instances | 0 | 0 |
| Total failures | 43 | 21 |
| Distinct failing combos | 34 | 17 |
| Clean rounds | 0 | 2 (rounds 4 and 9) |
| Highest cell | 3/10 `weak-network.spec.ts:247` webkit | 4/10 `target-switch.spec.ts:48` webkit |
| Candidate 2 (`:247` webkit) | 3/10 | **0/10** |
| Candidate 3 (`dpad.spec.ts:75` webkit) | 2/10 | **2/10** |
| `dpad.spec.ts:66` webkit | 2/10 | 0/10 |

Relative to `baseline.md`, dirty-round count fell from 10/10 to 8/10 and kind (a) instances fell from 32 to 14. Candidate 2's 3/10 cell is gone. Candidate 1 did **not** drive kind (a) to ~0: 14 suite timeouts remain, 12 of them chromium, including five beforeEach `page.goto` hangs. Candidate 3 is unchanged at 2/10. The new highest cell is `target-switch.spec.ts:48` at 4/10, which `baseline.md` already had as a 1/10 webkit assertion and left until the three named candidates were repaired.

## Conclusion

**漏斗仍轮轮脏**

Not "多数轮已干净、方向键是剩余主格": only 2 of 10 rounds are clean, so the majority is still dirty, and the remaining hotspot is not uniquely the d-pad (`target-switch.spec.ts:48` is 4/10; `dpad.spec.ts:75` is 2/10; 14 kind (a) cells are a 1/10 scatter).

Not "多数轮已干净且无稳定热点": majority is not clean, and there is a 4/10 cell plus leftover kind (a).

The local `test:pw` funnel is still not a reliable gate. Two green rounds (4 and 9) are real, but 8/10 rounds still fail, and 14 of 21 deaths are still kind (a) suite timeouts. This card does not open a repair.
