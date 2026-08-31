# Progress: e2e remeasure after candidates 1 and 2

Task: 10 serial full Playwright rounds on `card/e2e-remeasure` at `19f1c7101515070d21257b8ad0122cd62598ba30`, same algorithm as `docs/sessions/herdweb-e2e-flake/baseline.md`. No product or test edits.

Raw JSON: `/tmp/herdweb-e2e-remeasure-20260831/round-N.json` (not committed).

## Idle check

Immediately before round 1 setup, 2026-08-31T11:52:04+08:00.

Unfiltered `pgrep -af 'playwright|vitest|tsdown'`:

```
(empty)
```

Unfiltered `pgrep -fl 'playwright|vitest|tsdown'` was also empty.

After dropping lines that contain this dispatch id `dlg-20260831-035016-d94dc1` or the idle-check script path:

```
FILTERED_EMPTY
```

No Playwright / vitest / tsdown worker was running. Rounds will be serial. Shell had `CI=true` inherited from the delegate environment; every counted round unsets `CI` so `playwright.config.ts` keeps `retries: 0`.

## Rounds

`pnpm install` completed before round 1 (`@playwright/test` 1.58.2). Suite list: **118 tests in 16 files** (baseline was 116 in 15; `font-stylesheet.spec.ts` is new). Every counted round: `env -u CI pnpm exec playwright test --reporter=json`, wrapped in `/usr/bin/time -f 'WALL_SECONDS=%e'`. Counts walked from JSON `suites[].specs[].tests[].results[]`.

Failed-count sequence so far: **4 / 1 / 3 / 0 / 2 / 3 / 4 / 3**. Dirty 7/8; only round 4 is clean.

### After round 2 (2026-08-31T11:59:12+08:00)

| Round | wall (s) | passed | failed | skipped | timedOut | unexpected | dirty? |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 103.47 | 106 | 4 | 8 | 3 | 4 | dirty |
| 2 | 100.74 | 109 | 1 | 8 | 1 | 1 | dirty |

Round 1 failures:

- `chromium-android` `dpad.spec.ts:85` timedOut 30066 ms kind (a) beforeEach
- `webkit-iphone` `target-switch.spec.ts:48` failed 1612 ms (`expect(...).toContain`)
- `webkit-iphone` `weak-network.spec.ts:114` timedOut 30099 ms kind (a)
- `chromium-android` `weak-network.spec.ts:394` timedOut 30057 ms kind (a)

Round 2 failures:

- `webkit-iphone` `weak-network.spec.ts:317` timedOut 30091 ms kind (a)

`dpad.spec.ts:75` has not failed yet. Kind (a) is not zero after candidate 1. Round 3 started 2026-08-31T11:59:13+08:00.

### After round 4 (2026-08-31T12:02:01+08:00)

| Round | wall (s) | passed | failed | skipped | timedOut | unexpected | dirty? |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | 88.04 | 107 | 3 | 8 | 2 | 3 | dirty |
| 4 | 79.89 | 110 | 0 | 8 | 0 | 0 | clean |

Round 3 failures:

- `webkit-iphone` `dpad.spec.ts:75` failed 6615 ms kind (b) (`expect(...).toContain`, hold ⏎ → `0a`)
- `chromium-android` `smoke.spec.ts:62` timedOut 30170 ms kind (a)
- `chromium-android` `touch.spec.ts:20` timedOut 30166 ms kind (a) beforeEach

Round 4: no failures. First clean full suite in this remeasure.

Candidate 3 (`webkit-iphone` `dpad.spec.ts:75`) is 1/4 so far. Kind (a) still appears in 3 of 4 rounds. Round 5 started 2026-08-31T12:02:01+08:00.

### After round 6 (2026-08-31T12:04:56+08:00)

| Round | wall (s) | passed | failed | skipped | timedOut | unexpected | dirty? |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 5 | 95.46 | 108 | 2 | 8 | 1 | 2 | dirty |
| 6 | 80.34 | 107 | 3 | 8 | 2 | 3 | dirty |

Round 5 failures:

- `webkit-iphone` `dpad.spec.ts:75` failed 7470 ms kind (b)
- `chromium-android` `prefix.spec.ts:23` timedOut 30130 ms kind (a) beforeEach

Round 6 failures:

- `chromium-android` `dpad.spec.ts:111` timedOut 30064 ms kind (a)
- `chromium-android` `smoke.spec.ts:3` timedOut 30065 ms kind (a)
- `webkit-iphone` `target-switch.spec.ts:48` failed 1541 ms kind (b)

### After round 8 (2026-08-31T12:07:49+08:00)

| Round | wall (s) | passed | failed | skipped | timedOut | unexpected | dirty? |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 82.50 | 106 | 4 | 8 | 3 | 4 | dirty |
| 8 | 90.01 | 107 | 3 | 8 | 2 | 3 | dirty |

Round 7 failures:

- `chromium-android` `notify.spec.ts:112` timedOut 30043 ms kind (a)
- `webkit-iphone` `target-switch.spec.ts:48` failed 1453 ms kind (b)
- `chromium-android` `touch.spec.ts:35` timedOut 30053 ms kind (a) beforeEach
- `chromium-android` `touch.spec.ts:93` timedOut 30062 ms kind (a) beforeEach

Round 8 failures:

- `chromium-android` `asr.spec.ts:182` timedOut 30141 ms kind (a)
- `chromium-android` `smoke.spec.ts:52` timedOut 30160 ms kind (a)
- `webkit-iphone` `weak-network.spec.ts:140` failed 6435 ms kind (b)

`webkit-iphone` `dpad.spec.ts:75` is 2/8. `webkit-iphone` `target-switch.spec.ts:48` is 3/8. Candidate 2 (`weak-network.spec.ts:247` reconnect banner) has not failed. Kind (a) still in 7 of 8 rounds. Round 9 started 2026-08-31T12:07:49+08:00.
