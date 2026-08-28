# Configuration

How to write `herdweb.config.ts` after you have chosen a setup in the
[README](../README.md). Run `herdweb init` for a commented scaffold. All fields
are optional — the CLI fills in defaults when it loads the file.

For production systemd and port layout, see [Deploying herdweb](deploy-herdr.md).
For an interview-driven config, use the [herdweb-setup skill](../.agents/skills/herdweb-setup/SKILL.md).

## Config resolution

When `--config` is not specified, herdweb searches:

1. `herdweb.config.ts` / `.js` in the current directory
2. `~/.config/herdweb/herdweb.config.ts` / `.js` (XDG fallback)
3. Legacy upstream config paths (automatic fallback for migration)

Resolution is first-hit-wins and all-or-nothing: once a config file is found,
later locations are never read. This includes `.local` override files, which are
only looked up in the same directory as the resolved config. So if you create
`~/.config/herdweb/herdweb.config.ts` but leave old settings (for example
`mobile.keyboardMode: 'manual'`, ASR provider keys) in the legacy
`~/.config/remobi/` directory, they silently fall back to defaults — symptoms
like the soft keyboard popping up on every tap (`keyboardMode` back to `auto`)
or the voice input button disappearing (ASR key lost). When migrating, move all
settings and the `.local` file into the new directory together; don't split them
across both.

At runtime, herdweb validates the config object shape and rejects unknown keys
with path-based errors.

## Overlay defaults

Create `herdweb.config.ts` (or run `herdweb init`):

```typescript
export default {
  name: 'herdr',
  font: {
    family: 'JetBrainsMono NFM, monospace',
    mobileSizeDefault: 13,
    sizeRange: [8, 32],
  },
  toolbar: {
    // Single row by default: Esc, C-c, ✥ dpad-toggle, ⏎ Enter, 🎤 voice-input,
    // 🖼 image-upload, ⌨ keyboard-toggle, ☰ drawer-toggle
    row1: [
      { id: 'esc', label: 'Esc', description: 'Send Escape key', action: { type: 'send', data: '\x1b' } },
      { id: 'ctrl-c', label: 'C-c', description: 'Send Ctrl-C interrupt', action: { type: 'send', data: '\x03' } },
      // ...
    ],
    row2: [],
  },
  drawer: {
    buttons: [
      { id: 'herdr-new-window', label: '+ Win', description: 'Create herdr tab', action: { type: 'send', data: '\x02c' } },
      { id: 'herdr-split-v', label: 'Split |', description: 'Split pane side-by-side', action: { type: 'send', data: '\x02v' } },
      { id: 'herdr-split-h', label: 'Split —', description: 'Split pane stacked', action: { type: 'send', data: '\x02-' } },
      { id: 'herdr-zoom', label: 'Zoom', description: 'Toggle pane zoom', action: { type: 'send', data: '\x02z' } },
      { id: 'herdr-workspaces', label: 'Spaces', description: 'Workspace picker', action: { type: 'send', data: '\x02w' } },
      { id: 'herdr-sidebar', label: 'Sidebar', description: 'Toggle agent sidebar', action: { type: 'send', data: '\x02b' } },
      { id: 'herdr-scrollback', label: 'Scroll', description: 'Edit scrollback', action: { type: 'send', data: '\x02e' } },
      { id: 'herdr-kill-pane', label: 'Kill', description: 'Kill pane', action: { type: 'send', data: '\x02x' } },
      { id: 'herdr-help', label: 'Help', description: 'Show herdr help', action: { type: 'send', data: '\x02?' } },
      { id: 'herdr-prefix', label: 'Prefix', description: 'Send herdr prefix (Ctrl-B)', action: { type: 'send', data: '\x02' } },
      // ...
    ],
  },
  gestures: {
    swipe: {
      enabled: true,
      left: '\x02n',
      right: '\x02p',
      leftLabel: 'Next herdr tab',
      rightLabel: 'Previous herdr tab',
    },
    scroll: {
      enabled: true,
      strategy: 'wheel',
      speedMultiplier: 1,
      linesPerWheel: 1,
      momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
      maxLinesPerSend: 24,
      sendIntervalMs: 33,
    },
    pinch: { enabled: true },
  },
  mobile: {
    initData: '\x02z',
    widthThreshold: 768,
    keyboardMode: 'auto',
  },
  floatingButtons: [
    {
      position: 'top-left',
      buttons: [
        { id: 'zoom', label: 'Zoom', description: 'Toggle pane zoom', action: { type: 'send', data: '\x02z' } },
      ],
    },
  ],
  scrollButtons: {
    enabled: false,
  },
}
```

`gestures.scroll.strategy` controls touch scroll behaviour:

- `wheel` (default): sends SGR mouse wheel events with touch-mapped terminal coordinates.
- `keys`: sends `PageUp` / `PageDown` for app-level paging when preferred.

## Targets

Without a `targets` override, the config is **single** mode: the default target
is implicit and `-- <command...>` supplies its command. With `targets`, the
config is **explicit** mode and must also set `defaultTargetId` to one of the
unique target ids (1–8). The picker is created only when `targets.length > 1`,
not because the config is explicit; one explicit target is valid and still
hides the picker.

Each target is one spawn command that attaches to one [Herdr
server](https://herdr.dev/docs/concepts/#client-and-server). A named session on
the same machine (`herdr --session work`) is a separate server namespace. A
server on another machine is `herdr --remote <host>`, optionally with
`--session`. Two servers are two flat rows — not a device → server submenu.

```typescript
export default {
  defaultTargetId: 'local-dev',
  targets: [
    { id: 'local-dev', name: 'Local · Dev', command: ['herdr', '--session', 'herdweb-dev'], imageDrop: 'local-path' },
    { id: 'local', name: 'Local · Default', command: ['herdr', '--session', 'default'], imageDrop: 'local-path' },
    { id: 'workbox', name: 'Workbox', command: ['herdr', '--remote', 'workbox'], imageDrop: 'disabled' },
  ],
}
```

When more than one target is configured, a coarse-pointer / phone badge sits in
the bottom toolbar; a fine-pointer / desktop badge stays top-right. Tapping the
badge opens the flat target list.

The browser still has one WebSocket and one committed attachment. Selecting a
target first closes input, then waits for its snapshot; input reopens only after
the new attachment is committed. An unknown or stale id shows a restore error
instead of silently attaching another target. On reconnect, explicit mode
restores only a still-valid committed target; single mode always uses its
default target.

The server keeps target commands private. `herdr --remote` proves only the local
PTY/SSH thin-client process and its local exit facts; it is not evidence that a
remote pane is healthy.

See [How herdweb works](architecture/how-herdweb-works.md) for the registry and
attachment model.

## Target-scoped image insertion

The target summary advertises `imageDrop: 'local-path'` or `'disabled'`. Uploads
use the current committed attachment capability; a switch, detach, disconnect,
or stale attachment invalidates the upload and cannot insert its path. A
successful upload inserts the temporary path into the current agent input
without sending Enter. Disabled targets fail visibly.

## Voice composer input

Voice input is disabled by default. It is a browser-direct Doubao SAUC
connection: microphone audio and the API key stay in the browser-to-provider
path, so enable it only for a trusted single-user self-hosted deployment. Keep
the key in the `.local` config file; it is necessarily delivered to the browser
when voice input is enabled.

Microphone capture requires a secure browser context: use HTTPS on a phone (for
example Tailscale Serve or an HTTPS reverse proxy). `localhost` and `127.0.0.1`
are secure-context exceptions for local development; a plain HTTP LAN address is
not. If the browser cannot use `getUserMedia`, herdweb hides the voice composer
entry instead of showing an unusable control.

```typescript
// herdweb.config.ts — shared settings, no secret
export default {
  asr: {
    enabled: true,
    autoEnter: true,
  },
}
```

```typescript
// herdweb.config.local.ts — keep this file private
export default {
  asr: {
    doubao: {
      apiKey: 'your-volcengine-api-key',
      resourceId: 'volc.seedasr.sauc.duration',
    },
  },
}
```

The `voice-input` action is toolbar-only; putting it in `drawer.buttons` or
`floatingButtons` is rejected by config validation.

## Push notifications

herdweb can push Web Push notifications to your phone when agents need
attention, when output goes quiet, or when the service restarts. Subscribe from
the in-app panel — no separate app install.

Notification identity follows the target mode: single mode accepts v1 events
without `targetId`; explicit mode accepts v2 events only when `targetId` names a
configured target. History, deduplication, notification tags, and
notification-click target selection use the same identity. A click focuses the
open herdweb page and requests that target, or opens a URL carrying the target
when no page is open.

**Prerequisites**

- **Android**: Chrome (or another browser with Web Push + service workers).
- **iOS**: herdweb must be **added to the Home Screen** as a standalone PWA
  (iOS 16.4+). Safari tabs do not expose the Push API — subscription will not
  work in a normal browser tab.
- **HTTPS** on phones (Tailscale Serve, reverse proxy, etc.). `localhost` /
  `127.0.0.1` work for local dev only.

**Subscribe and test**

1. Open herdweb on your phone.
2. Tap **☰** (drawer) in the toolbar, then **🔔** in the drawer grid.
3. In the **Notifications** panel, enable **Push notifications** and accept the
   browser permission prompt.
4. Tap **Send test notification** — a system notification should arrive within a
   few seconds.
5. Tap the notification — herdweb should focus (or open) in the browser/PWA.

On iPhone, if you are not in standalone mode, the panel shows a hint to add
herdweb to the Home Screen first.

**Outbound notification channels**

Web Push and outbound channels run in parallel, but only after the attention
gate (see **What gets notified** below). Channels are disabled by default;
configure one or more fixed-shape webhook destinations under `notify.channels`
when a device cannot reach its push provider. Each outbound event is posted
once to every configured channel. A failed channel is logged with its type,
host, and status/error name, but does not block Web Push or another channel;
there is no retry queue in v1.

```ts
export default {
  notify: {
    channels: [
      {
        type: 'message-pusher',
        url: 'https://push.example.com',
        user: 'someone',
        token: 'token-placeholder',
      },
      {
        type: 'wecom',
        url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-placeholder',
      },
      {
        type: 'webhook',
        url: 'https://example.com/hook',
        headers: { 'x-source': 'herdweb' },
      },
    ],
  },
}
```

`message-pusher` posts JSON to `{url}/push/{user}` with `{ title, desp, content, token }`.
`wecom` posts `{ msgtype: 'text', text: { content } }` to the configured URL.
`webhook` posts the event object itself and applies the configured headers. All
requests are JSON and time out after 10 seconds. Keep webhook query keys,
tokens, and custom header values in a local, uncommitted config file.

**Decision logs**

Each send and each intentional skip writes one `console.log` line starting with
`herdweb: notify decision`. Idle ticks do not: never armed, `enabled=false`,
quiet period not elapsed, no previous session, or the same `sessionId`. Channel
HTTP results stay on `herdweb: notify channel` and include `kind=` and `id=` so
they can be joined to the decision line. WeCom HTTP 2xx with JSON `errcode` not
equal to `0` is logged as `failed`, not `delivered`.

```bash
journalctl --user -u herdweb.service --grep 'herdweb: notify decision'
journalctl --user -u herdweb.service --grep 'herdweb: notify channel'
```

`reason=` is one of: `armed-quiet`, `session-end`, `service-restart`,
`cooldown`, `lane-cooldown`, `restart-gap`, `duplicate`, `not-loopback`,
`unauthorized`, `rate-limited`, `invalid-event`, `payload-too-large`,
`not-attention`, `child-done`, `done-coalesced`.

**What gets notified (and how fast)**

Event history (`events.jsonl` and the panel list) records every accepted
fact. Web Push and `notify.channels` are a separate outbound gate: they
fire only when a human should intervene (you must answer, or the service
died) or when the original long-running task finishes.

| kind | History | Outbound (Web Push / channels) |
|------|---------|--------------------------------|
| `asking` | written | immediate |
| `health` | written | immediate |
| `test` | not written | immediate |
| `ci-red` | written | immediate (producer not wired yet; treated as blocking if it arrives) |
| `silence` | written | never (`not-attention`; the detector may still log `armed-quiet`) |
| `done` + `role=root` | written | immediate |
| `done` + `role=child` | written | never (`child-done`) |
| `done` with no `role` | written | last event per `session` (missing session uses `default`) after 600s of quiet (`done-coalesced`; each new unlabeled done resets the timer). v1 merge key is session-only — parallel repos that share a session name can swallow each other's unlabeled completions. |

`role` is `root` or `child` (optional). `parentId` and `startedAt` are
optional inbound fields stored in history; they do not change the gate.
Until producers send `role`, unlabeled `done` events coalesce. Producer
labeling is tracked in [agent-config#843](https://github.com/zlxlabs/agent-config/issues/843).
A process drain (`awaitInFlight` / `dispose`) flushes a still-pending
unlabeled `done` so shutdown does not drop the last completion.

The silence lane cannot distinguish “waiting for you” from “running a long
task” — titles use “may be done / stuck” wording, and that guess is kept
in history only. A `202` response from `POST /api/events` means the event
was accepted into history (and de-duplicated) — not that it will be
pushed, and not that the phone has already displayed it.

**Known limitations**

Some Android devices cannot receive any Web Push notification when the device's
long-lived connection from Google Play services to FCM is unreachable. This is
not a herdweb-specific issue: the official Google push demo is also unable to
deliver in that environment. A browser being able to browse the web does not
imply that FCM is reachable; Web Push depends on Google Play services
maintaining a long-lived connection to `mtalk.google.com` on ports `5228`,
`5229`, or `5230`. Configure an outbound channel above as the workaround for
those devices; message-pusher and the WeCom webhook do not depend on the
device's FCM connection.

**State directory (per port)**

Runtime files live under `~/.local/state/herdweb/{port}/` (or
`$XDG_STATE_HOME/herdweb/{port}/`). Production (`7681`) and debug (`7691`)
instances use separate directories so VAPID keys, subscriptions, and event
history do not collide. See [Deploying herdweb](deploy-herdr.md) for the
production layout.

| File | Purpose |
|------|---------|
| `vapid.json` | VAPID keys (mode `0600`). Auto-generated on first `herdweb serve` if missing; startup logs a one-line hint. |
| `push-subscriptions.json` | Registered device endpoints |
| `events.jsonl` | Event history (`kind=test` events are not persisted) |
| `last-session.json` | Per target identity — used for restart / exit health notifications |

Rotate VAPID keys via `notify.vapid.*` in config. Old subscriptions become
invalid after a key change — users must re-subscribe.

Apple Push Notification service validates the VAPID JWT `sub` claim strictly:
the subject must be a format-legal `mailto:` contact (e.g.
`mailto:you@yourdomain.com`). Reserved or non-deliverable domains such as
`mailto:herdweb@localhost` are rejected with `403 BadJwtToken` — iOS devices
receive no push and stale subscriptions may be removed server-side, with no
obvious error in the herdweb UI. Google/FCM does not enforce this check. For
production, set `notify.vapid.subject: 'mailto:<your-email>'` in config
(subject changes do not invalidate existing subscriptions).

**Local events API**

`POST {basePath}/api/events` accepts events from **loopback only**
(`127.0.0.1` / `::1` / `localhost`). Optional `notify.token` in config requires
matching `Authorization: Bearer …` on the request. External event sources (e.g.
agent-config badge outbound) must run on the **same machine** as herdweb —
cross-host posting is not supported in v1.

Single-mode smoke test (with `herdweb serve` on port 7681, after subscribing on
a device; **single-only**):

```bash
curl -sS -X POST 'http://127.0.0.1:7681/api/events' \
  -H 'content-type: application/json' \
  -d '{"v":1,"id":"smoke-1","kind":"test","title":"curl smoke","body":"from loopback","ts":'"$(date +%s000)"'}'
```

Expect HTTP `202` only when the service is in single mode. If `notify.token` is
set, add `-H 'authorization: Bearer <token>'`.

For an explicit-mode service whose config contains target id `local`, use the
v2 event shape instead:

```bash
curl -sS -X POST 'http://127.0.0.1:7681/api/events' \
  -H 'content-type: application/json' \
  -d '{"v":2,"targetId":"local","id":"smoke-v2-1","kind":"test","title":"curl smoke","body":"from loopback","ts":'"$(date +%s000)"'}'
```

Expect HTTP `202`; `targetId` must name a configured target. If `notify.token`
is set, add the same Bearer header.

**Restart behaviour**

When herdweb or the PTY session restarts, the health lane sends **one**
notification per incident: exit notifications on PTY shutdown; a separate
“service restarted” notification only if the new session starts more than 120
seconds after the previous exit (crash-loops inside that window collapse to a
single exit notification).
