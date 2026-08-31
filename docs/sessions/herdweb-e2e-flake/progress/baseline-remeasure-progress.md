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

Failed-count sequence so far: **4 / 1**. Both rounds dirty.

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
