# WebKit `touch.spec.ts:93` Synthesised Click Backdrop Guard Diagnosis (Issue #135)

Recorded 2026-08-31 on worktree `herdweb-20260831-13`, base `bf8d26d1a44858adf714950b642d0c337e40bfa0` (`main`).

## 1. Phenomenon & Baseline

- **Test:** `tests/playwright/touch.spec.ts:93` (`synthesised click from tap() hits backdrop (regression guard)`).
- **Result on WebKit (`webkit-iphone`):** 10/10 deterministic failure. Duration ~1.1–1.4s per run, retry=0.
  - Failure point: `touch.spec.ts:120`: `expect(clicks.length).toBeGreaterThan(0)` received `0`.
- **Result on Chromium (`chromium-android`):** 5/5 deterministic pass.
- **Root Question:** Why did synthesised click not hit `#wt-backdrop` on WebKit? Is it a product regression or test precondition invalidity?

## 2. Idle Check

Before diagnostic measurements, `ps -eo pid,args` / `ps -ef` verified that no background `playwright`, `vitest`, or `tsdown` processes were running on the host.

## 3. Event Sequence & Evidence

We added a capture-phase diagnostic probe on `document` recording all pointer, touch, and mouse events with coordinates, target IDs/tags, `isTrusted`, and `document.elementFromPoint(clientX, clientY)`:

### Chromium (`chromium-android`) Trace:
```json
[
  { "type": "pointerdown", "targetTag": "BUTTON", "targetText": "☰", "clientX": 365, "clientY": 699, "elementFromPoint": "BUTTON" },
  { "type": "touchstart",  "targetTag": "BUTTON", "targetText": "☰", "clientX": 365, "clientY": 699, "elementFromPoint": "BUTTON" },
  { "type": "pointerup",   "targetTag": "BUTTON", "targetText": "☰", "clientX": 365, "clientY": 699, "elementFromPoint": "BUTTON" },
  { "type": "touchend",    "targetTag": "BUTTON", "targetText": "☰", "clientX": 365, "clientY": 699, "elementFromPoint": "BUTTON" },
  { "type": "mousedown",   "targetId": "wt-backdrop", "targetTag": "DIV", "clientX": 365, "clientY": 699, "elementFromPoint": "wt-backdrop" },
  { "type": "mouseup",     "targetId": "wt-backdrop", "targetTag": "DIV", "clientX": 365, "clientY": 699, "elementFromPoint": "wt-backdrop" },
  { "type": "click",       "targetId": "wt-backdrop", "targetTag": "DIV", "clientX": 365, "clientY": 699, "elementFromPoint": "wt-backdrop", "isTrusted": true }
]
```

### WebKit (`webkit-iphone`) Trace:
```json
[
  { "type": "pointerdown", "targetTag": "BUTTON", "targetText": "☰", "clientX": 360, "clientY": 636, "elementFromPoint": "BUTTON" },
  { "type": "touchstart",  "targetTag": "BUTTON", "targetText": "☰", "clientX": 360, "clientY": 636, "elementFromPoint": "BUTTON" },
  { "type": "pointerup",   "targetTag": "BUTTON", "targetText": "☰", "clientX": 360, "clientY": 636, "elementFromPoint": "BUTTON" },
  { "type": "touchend",    "targetTag": "BUTTON", "targetText": "☰", "clientX": 360, "clientY": 636, "elementFromPoint": "BUTTON" },
  { "type": "mousedown",   "targetTag": "BUTTON", "targetText": "☰", "clientX": 360, "clientY": 636, "elementFromPoint": "BUTTON" },
  { "type": "mouseup",     "targetId": "wt-backdrop", "targetTag": "DIV", "clientX": 360, "clientY": 636, "elementFromPoint": "wt-backdrop" },
  { "type": "click",       "targetTag": "BODY", "clientX": 360, "clientY": 636, "elementFromPoint": "wt-backdrop", "isTrusted": true }
]
```

## 4. Mechanism & Root Cause Analysis

1. **Touchend opens overlay:**
   - In both engines, `touchend` fires on `#wt-toolbar button` (☰).
   - Its `onTap` handler executes `open()`, making `#wt-backdrop` `display: block` (`z-index: 10000`) and opening `#wt-drawer` (`z-index: 10001`).

2. **Browser synthesised mouse events:**
   - **Chromium:** Re-evaluates layout hit-testing at (365, 699) before dispatching synthesised mouse events. Because `#wt-backdrop` (`z-index: 10000`) now covers `#wt-toolbar` (`z-index: 9999`), `mousedown`, `mouseup`, and `click` are all dispatched with `target === #wt-backdrop`.
   - **WebKit:** Dispatches synthesised `mousedown` targeting the original touch target (`BUTTON`). By `mouseup`, layout update is reflected and hit-test finds `#wt-backdrop`.
   - **W3C UI Events Specification (Section 3.5 & 5.1.2):**
     > "The click event type must be dispatched on the topmost event target indicated by the pointer, when the pointer is down and up over the same target. If mousedown and mouseup are dispatched on different elements, the click event must be dispatched on the nearest common ancestor of both elements."
   - Because `BUTTON` (inside `#wt-toolbar`, child of `<body>`) and `#wt-backdrop` (child of `<body>`) have different parents, their Lowest Common Ancestor (LCA) is `document.body`.
   - Therefore, WebKit dispatches the trusted synthesised `click` event to `<body>`, at client coordinates `(360, 636)`, where `document.elementFromPoint(360, 636)` is `#wt-backdrop`.

3. **Product behavior vs Test precondition:**
   - **Product (`src/util/tap.ts`):** `touchFired = true` blocks all `onTap` click handlers for 400ms across all elements. The drawer remains open in both WebKit and Chromium.
   - **Test precondition (`tests/playwright/touch.spec.ts:93`):** The test listener filtered specifically with `(e.target as HTMLElement)?.id === 'wt-backdrop'`. In WebKit, because `e.target` is `<body>`, the filter returned false and `clicks.length` was 0, causing the assertion failure.
   - **Conclusion:** The product is working correctly; the test assumption that `click.target.id === 'wt-backdrop'` is Chromium-specific and violated WebKit's standards-compliant LCA event dispatching behavior.

## 5. One-Sentence Fix Plan

Update `tests/playwright/touch.spec.ts:93` to capture trusted synthesised clicks fired during `tap()` and assert that the click event is dispatched over the backdrop coordinates (`document.elementFromPoint(clientX, clientY)?.id === 'wt-backdrop'`) while verifying that the drawer remains open.
