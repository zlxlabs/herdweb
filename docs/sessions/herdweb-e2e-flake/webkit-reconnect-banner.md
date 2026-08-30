# WebKit reconnect-banner assertion: transient already gone

Issue #135 candidate 2. The test
`killing the socket while hidden reconnects behind a banner that keeps the old screen`
(`tests/playwright/weak-network.spec.ts`) used `context.setOffline(true)` to keep
the reconnect overlay in `Reconnecting` / `Syncing` / `Disconnected` long enough
for `toContainText` to match. That hold does not work on WebKit against loopback.

## Failure

On unmodified `da96b51`, WebKit failed on the first isolated run:

```
Expected pattern: /Reconnecting|Syncing|Disconnected/
Received string:  "SyncedRetry nowRe-authenticate"
Timeout: 5000ms
locator resolved to <div data-layout="banner" id="herdweb-reconnect-overlay"
  data-connection-state="synced">
```

The overlay accessibility tree omitted the node (it is `display:none` when
`state === 'synced'`). Chromium on the same commit passed in 1.7s.

## Probe: `setOffline` vs loopback WebSocket

After `context.setOffline(true)`:

| | `navigator.onLine` | `fetch(/)` | `new WebSocket(ws://127.0.0.1:<port>/ws)` |
|---|---|---|---|
| WebKit | `false` | `TypeError: Load failed` | **`open` / `readyState: 1`** |
| Chromium | `false` | `TypeError: Failed to fetch` | `close` / `readyState: 3` / code `1006` |

WebKit marks the page offline and blocks HTTP, but still lets a loopback
WebSocket complete. The client then reconnects for real.

## Overlay timeline (WebKit, MutationObserver)

Timestamps are `performance.now()` ms from the same page:

1. `t=359` `synced` `display:none`
2. `t=361` `disconnected` `display:flex` `"Disconnected"`
3. `t=365` `reconnecting` `display:flex` `"Reconnecting…"`
4. `t=369` `syncing` `display:flex` `"Syncing…"`
5. `t=384` `synced` `display:none` `"Synced"`

The banner is real (~25ms). Playwright's next `toContainText` (5s retry) starts
after `synced`, and `src/reconnect.ts` never leaves `synced` on its own, so the
retry cannot recover. That matches CI: 6/6 attempts red at the same line.

Chromium stays at `reconnecting` / `display:flex` / socket `readyState: 3`
because `setOffline` actually blocks the socket.

## Fix

The product state machine is fine. The test now holds the next `/ws` handshake
with `page.routeWebSocket` (same pattern as the modal overlay test in this file)
so the banner stays in a non-synced state until assertions finish, then
releases and waits for `synced`. `Synced` is not added to the text regex.
