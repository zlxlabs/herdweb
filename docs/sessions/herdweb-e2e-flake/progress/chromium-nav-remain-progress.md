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

Not started. Waiting on the single product change.
