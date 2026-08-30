# e2e Service Worker cost measurement (issue #62)

Recorded on 2026-08-30, worktree `herdweb-20260830-10`, HEAD
`4c3918dba419485e73a80cad214b69d8e23126fe` (`main` at dispatch).

Command for every round: `pnpm run test:pw` (both Playwright projects,
`retries: 0` because `CI` is unset). Wall-clock from `/usr/bin/time -f
'WALL_SECONDS=%e'` wrapping that command; Playwright's own `(Nm)` summary
is also recorded.

## Current suite size (stale "86" baseline)

`pnpm exec playwright test --list` on this checkout:

```
Total: 116 tests in 15 files
```

Issue #62's "82 → 86" count is **stale**. This checkout lists 116 tests.
Eight of them are `test.skip` (not new skips introduced by this work):

- `asr.spec.ts`: 4 chromium-only voice-flow tests skip on webkit; 1
  webkit-only degradation test skips on chromium (5 skip events / run)
- `notify.spec.ts`: 2 tests skip on webkit
- `dpad.spec.ts`: 1 clipboard test skips on webkit

Runnable per round = 116 − 8 = 108. Passed-count comparisons below use
the measured 100–105 range, not the historical 86.

## Idle check (constraint 5)

Exact command `pgrep -fl 'playwright|vitest|tsdown'` immediately before
round 1 (2026-08-30T23:30:49+08:00):

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

No other e2e / vitest / tsdown process was running. Measurement rounds
were serial; no `pnpm test` in parallel.

## Baseline (Service Worker **not** blocked)

Same checkout, no fixture changes. Three full-suite rounds.

| Round | WALL_SECONDS | Playwright wall | passed | failed | skipped | exit |
| ----- | ------------ | --------------- | ------ | ------ | ------- | ---- |
| 1     | 98.16        | 1.6m            | 105    | 3      | 8       | 1    |
| 2     | 121.56       | 2.0m            | 100    | 8      | 8       | 1    |
| 3     | 106.88       | 1.8m            | 105    | 3      | 8       | 1    |

Range: wall 98.16–121.56s (spread 23.4s / 0.4m). Failed 3/8/3.
Passed 105/100/105. Skipped 8/8/8.

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

## Shielded (Service Worker blocked) — pending

Fixture change and three shielded rounds land in a later commit, after
this baseline file is on the branch.

## Conclusion — pending the shielded arm
