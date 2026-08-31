# 10-round e2e remeasure after touch repair (issue #135 closure)

Recorded 2026-08-31 16:01–16:14 (+08:00) on base `29d2993` (`origin/main`), after merging the touch backdrop-click repair (PR #146).

Ten serial full-suite Playwright runs, both projects (`chromium-android`, `webkit-iphone`), with `retries: 0` (`CI` unset). Every round used:

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/herdweb-e2e-post-touch-20260831/round-N.json \
  /usr/bin/time -f 'WALL_SECONDS=%e' \
  env -u CI pnpm exec playwright test --reporter=line --reporter=json
```

Raw JSON and run logs stay in `/tmp/herdweb-e2e-post-touch-20260831/` and are not committed to git.

## Measurement Discipline & Pre-flight

- **Suite size**: 118 tests in 16 files (110 runnable + 8 existing `test.skip`: ASR mutex 5, notify webkit 2, dpad clipboard webkit 1). Total 1,180 test executions walked across 10 rounds.
- **Idle check**: Pre-flight inspection via `ps -eo pid,args` confirmed no leftover `playwright`, `vitest`, or `tsdown` processes. Runs were strictly serial.
- **Environment & retries**: Executed with `env -u CI` to prevent inheriting `CI=true`. Walked JSON confirms every result across all 10 rounds has `retry: 0`.

## Per-round Results

Single-round wall clock ran between 67.42s and 85.66s (total ~12.7 minutes for 10 rounds).

| Round | JSON path | wall (s) | passed | failed | skipped | kind (a) | dirty? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `/tmp/herdweb-e2e-post-touch-20260831/round-1.json` | 67.77 | 109 | 1 | 8 | 0 | dirty |
| 2 | `/tmp/herdweb-e2e-post-touch-20260831/round-2.json` | 67.42 | 110 | 0 | 8 | 0 | clean |
| 3 | `/tmp/herdweb-e2e-post-touch-20260831/round-3.json` | 70.87 | 110 | 0 | 8 | 0 | clean |
| 4 | `/tmp/herdweb-e2e-post-touch-20260831/round-4.json` | 77.62 | 110 | 0 | 8 | 0 | clean |
| 5 | `/tmp/herdweb-e2e-post-touch-20260831/round-5.json` | 77.50 | 110 | 0 | 8 | 0 | clean |
| 6 | `/tmp/herdweb-e2e-post-touch-20260831/round-6.json` | 82.47 | 110 | 0 | 8 | 0 | clean |
| 7 | `/tmp/herdweb-e2e-post-touch-20260831/round-7.json` | 78.98 | 110 | 0 | 8 | 0 | clean |
| 8 | `/tmp/herdweb-e2e-post-touch-20260831/round-8.json` | 82.96 | 110 | 0 | 8 | 0 | clean |
| 9 | `/tmp/herdweb-e2e-post-touch-20260831/round-9.json` | 85.66 | 110 | 0 | 8 | 0 | clean |
| 10 | `/tmp/herdweb-e2e-post-touch-20260831/round-10.json` | 74.14 | 110 | 0 | 8 | 0 | clean |

- **Clean rounds**: 9/10 (rounds 2–10).
- **Dirty rounds**: 1/10 (round 1 only).
- **Kind (a) suite timeouts** (`status=timedOut` and duration ≥ 29,000ms): **0** across all 10 rounds.

## Failure Forensics (Round 1)

Across 1,180 test executions, exactly one test failed:

- **Spec / line**: `tests/playwright/dpad.spec.ts:75` (`holding ⏎ sends \n (0a) and never \r (0d)`)
- **Project**: `chromium-android`
- **JSON result**: `status=failed`, duration `6644ms`, `retry=0`
- **Location**: `tests/playwright/dpad.spec.ts:81:2` (`await expect.poll(() => screenText(page)).toContain('0a')`)
- **Failure message**:
  ```
  Error: expect(received).toContain(expected) // indexOf

  Expected substring: "0a"
  Received string:    "bash-5.2$ printf 'byte-ready\\n'; stty -echo -icrnl; while IFS= read -rsn1 -d '' c || [ -n \"$c\" ]; do printf '%02x\\n' \"'$c\"; donebyte-ready "

  Call Log:
  - Timeout 5000ms exceeded while waiting on the predicate
  ```
- **Signature analysis**: Long press (650ms) resulted in 0 input bytes received at the PTY probe before the 5000ms poll timeout. This failure matches the signature previously observed on `webkit-iphone` (2/10 in `baseline-after-c1-c2.md`), indicating cross-engine timing instability for this test.

## Status of Historical Hotspots

All previous flake hotspots recorded 0/10 failures in this remeasure:

- `webkit-iphone` `touch.spec.ts:93` (PR #146): **0/10** (repaired)
- `webkit-iphone` `target-switch.spec.ts:48` (PR #144): **0/10** (repaired)
- `webkit-iphone` `weak-network.spec.ts:247` (PR #140): **0/10** (repaired)
- `chromium-android` `notify.spec.ts:23`: **0/10** (no recurrence)
- `webkit-iphone` `dpad.spec.ts:66`: **0/10** (no recurrence)

## Comparison with Baselines

| Metric | `baseline.md` (initial) | `baseline-after-c1-c2.md` | `chromium-nav-remain.md` | This Remeasure (post-touch) |
| --- | --- | --- | --- | --- |
| Dirty rounds / 10 | 10/10 | 8/10 | 10/10 | **1/10** |
| Kind (a) instances (hangs) | 32 | 14 | 1 | **0** |
| Total failures | 43 | 21 | 1–2 per round | **1** |

## Conclusion & Issue Tracking

1. **Issue #135 Closure**: The systemic e2e flake and kind (a) navigation hangs targeted by #135 are resolved (0 kind (a) occurrences, 9/10 clean rounds). Issue #135 has been closed with full closure evidence.
2. **Issue #147 Opened**: The lone remaining flake (`dpad.spec.ts:75` 650ms hold timing) has been split into dedicated tracking issue #147.
