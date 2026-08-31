# Progress: remaining Chromium navigation hang

Task: capture a current-main Chromium hang trace, change one product behaviour on the font loading path, then 10 serial full Playwright rounds on `card/herdweb-20260831-11` at `f22d4be3fefa8fa7246b1ef71015fc958eeb8e9a`. Compare kind (a) against `docs/sessions/herdweb-e2e-flake/baseline-after-c1-c2.md` (14 instances). Success is a drop in kind (a), not a single green round.

Raw JSON / traces: `/tmp/herdweb-chromium-nav-remain-20260831/` (not committed).

## Idle check

Immediately before diagnostic round 1, 2026-08-31T13:44:32+08:00.

`ps -eo pid,args` lines matching `playwright|vitest|tsdown`:

```
2302548 /usr/bin/zsh -c ... IDLE CHECK ...
2302561 awk BEGIN{IGNORECASE=1} /playwright|vitest|tsdown/ {print}
```

After dropping the idle-check wrapper and its `awk`: **FILTERED_EMPTY**.

No Playwright / vitest / tsdown worker was running. Rounds will be serial. Shell had `CI=true` inherited from the delegate environment; every counted round unsets `CI` so `playwright.config.ts` keeps `retries: 0`.

## Diagnostic round (trace on)

Command: `env -u CI pnpm exec playwright test --trace retain-on-failure --reporter=json`, wrapped in `/usr/bin/time -f 'WALL_SECONDS=%e'`. JSON `retry` was `0`.

| Round | JSON path | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| diag-1 | `/tmp/herdweb-chromium-nav-remain-20260831/diag-r1/results.json` | 80.43 | 109 | 1 | 8 | 1 | 1 | dirty |

The one failure is `chromium-android` `keyboard-toggle.spec.ts:60`, JSON `status=timedOut` duration `30127` ms, `page.goto` waiting until `load`. HAR pending URL: `https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/jetbrainsmono-nfm.css` (`time=-1`, `status=-1`). Details: `docs/sessions/herdweb-e2e-flake/chromium-nav-remain.md`.

## 10-round verification

Command for every counted round:

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/herdweb-chromium-nav-remain-20260831/round-N.json \
  /usr/bin/time -f 'WALL_SECONDS=%e' \
  env -u CI pnpm exec playwright test --reporter=line --reporter=json
```

Counts walked from JSON `suites[].specs[].tests[].results[]`. `retry` was `{0}` in every walked round so far. Kind (a) = `status=timedOut` and duration ≥ 29_000 ms.

### After round 2 (2026-08-31T13:55:58+08:00)

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `/tmp/herdweb-chromium-nav-remain-20260831/round-1.json` | 152711 | 65.62 | 108 | 2 | 8 | 0 | 0 | dirty |
| 2 | `/tmp/herdweb-chromium-nav-remain-20260831/round-2.json` | 152739 | 63.88 | 108 | 2 | 8 | 0 | 0 | dirty |

Round 1 and 2 failures (kind (b) assertions, out of this card's product change):

- `chromium-android` `dpad.spec.ts:75` failed ~6.5 s (`expect.poll(...).toContain('0a')`)
- `webkit-iphone` `touch.spec.ts:93` failed ~1.3 s (`expect(clicks.length).toBeGreaterThan(0)`)

No Chromium `page.goto` 30 s hang. Kind (a) running total: **0** (baseline-after-c1-c2 was 14).

### After round 4 (2026-08-31T13:58:30+08:00)

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | `/tmp/herdweb-chromium-nav-remain-20260831/round-3.json` | 149157 | 63.06 | 109 | 1 | 8 | 0 | 0 | dirty |
| 4 | `/tmp/herdweb-chromium-nav-remain-20260831/round-4.json` | 149144 | 62.08 | 109 | 1 | 8 | 0 | 0 | dirty |

Round 3 and 4 failure: `webkit-iphone` `touch.spec.ts:93` kind (b). Kind (a) running total still **0**.

### After round 6 (2026-08-31T14:00:52+08:00)

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 5 | `/tmp/herdweb-chromium-nav-remain-20260831/round-5.json` | 149165 | 62.61 | 109 | 1 | 8 | 0 | 0 | dirty |
| 6 | `/tmp/herdweb-chromium-nav-remain-20260831/round-6.json` | 149127 | 62.82 | 109 | 1 | 8 | 0 | 0 | dirty |

Round 5 and 6 failure: `webkit-iphone` `touch.spec.ts:93` kind (b). Kind (a) running total still **0**.

### After round 8 (2026-08-31T14:03:46+08:00)

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | `/tmp/herdweb-chromium-nav-remain-20260831/round-7.json` | 152230 | 66.57 | 108 | 2 | 8 | 0 | 0 | dirty |
| 8 | `/tmp/herdweb-chromium-nav-remain-20260831/round-8.json` | 149896 | 67.77 | 108 | 2 | 8 | 1 | 1 | dirty |

Round 7 failures: `chromium-android` `dpad.spec.ts:85` kind (b); `webkit-iphone` `touch.spec.ts:93` kind (b).

Round 8 failures: `chromium-android` `notify.spec.ts:23` **kind (a)** `timedOut` 30069 ms (body timeout, not a `beforeEach` `page.goto`); `webkit-iphone` `touch.spec.ts:93` kind (b).

Kind (a) running total: **1** (baseline-after-c1-c2 was 14).

### After round 10 (2026-08-31T14:06:22+08:00)

| Round | JSON path | bytes | wall (s) | passed | failed | skipped | timedOut | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 9 | `/tmp/herdweb-chromium-nav-remain-20260831/round-9.json` | 149156 | 66.81 | 109 | 1 | 8 | 0 | 0 | dirty |
| 10 | `/tmp/herdweb-chromium-nav-remain-20260831/round-10.json` | 149146 | 67.32 | 109 | 1 | 8 | 0 | 0 | dirty |

Round 9 and 10 failure: `webkit-iphone` `touch.spec.ts:93` kind (b).

## Kind (a) versus baseline-after-c1-c2

| Metric | baseline-after-c1-c2 | this card |
| --- | ---: | ---: |
| Kind (a) instances | 14 | **1** |
| Dirty rounds / 10 | 8/10 | 10/10 |
| Clean rounds | 2 | 0 |

Kind (a) dropped from 14 to 1. The remaining kind (a) is round 8 `chromium-android` `notify.spec.ts:23` (body timeout, not a font-CSS `page.goto`). The funnel is **not** clean: every round had at least one kind (b) (`touch.spec.ts:93` webkit 10/10; `dpad.spec.ts:75` chromium 2/10). Those are out of this card.
