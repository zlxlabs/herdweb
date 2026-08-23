---
name: herdweb-setup
description: >
  Full interactive onboarding for herdweb — the mobile Web UI for herdr.
  Checks prerequisites, interviews the user about their workflow, generates a
  validated herdweb.config.ts, and walks through deployment. Use this skill
  whenever someone asks to set up herdweb, configure herdweb, onboard with
  herdweb, generate a herdweb config, or deploy herdweb with Tailscale. Also
  use when the user says "onboard me" or "set up my phone terminal".
---

# herdweb-setup

Interactive onboarding skill for herdweb — purpose-built Web UI for [herdr](https://github.com/ogulcancelik/herdr).

The guiding principle: **detect everything possible, default everything sensible, ask only what requires human intent.** Most users answer 1–3 questions total.

## Workflow

### Phase 1: Welcome and understand (1 question)

Open with a one-liner confirming what they're getting, then ask what brings them here:

> "herdweb puts your herdr session on your phone — same panes, same tabs, touch controls on top. Everything we set up here you can change later."
>
> "What brings you to herdweb? For example: monitoring coding agents from your phone, getting phone access to your agent sessions, or just curious to try it out."

Map the answer to a persona internally (don't tell the user their "persona"):

| Persona | Signals | Downstream effect |
|---------|---------|-------------------|
| **Agent Watcher** | Mentions coding agents, Claude Code, Codex, AI, monitoring | Auto-zoom on, floating zoom button, double-tap zoom enabled, lean config |
| **Remote Dev** | Mentions herdr, dev workflow, existing setup | Inspect herdr config, ask about auto-zoom |
| **Newcomer** | Says curious, trying it out, heard about it | Auto-zoom on, sensible defaults |

If ambiguous, lean towards Agent Watcher.

### Phase 2: Environment check

Run silently, then report what's present vs missing:

```bash
node --version          # need >= 22
which herdr             # herdr multiplexer
```

If anything is missing, help install it:
- **Node**: suggest mise, nvm, or direct install
- **herdr**: see [herdr install docs](https://github.com/ogulcancelik/herdr#installation)

herdr captures mouse input by default — touch scroll and tap-to-focus work with no extra multiplexer configuration.

#### Inspect herdr (optional)

If the user has custom keybindings, inspect:

```bash
cat ~/.config/herdr/config.toml 2>/dev/null
```

Note any remapped prefix or bindings. herdr's default prefix is Ctrl-B (`\x02`).

herdr has a built-in single-column layout for narrow terminals (`ui.mobile_width_threshold` in `config.toml`).

### Phase 3: Confirm detections and ask what's needed (0–2 questions)

Present a summary of what you found and what you plan to configure:

> "Based on your setup, here's what I'll configure:
> - Default herdr drawer buttons (split, zoom, workspaces, sidebar, scrollback, kill, help, prefix)
> - Auto-zoom on mobile load (pane fills the phone screen)
> - Floating zoom button (one-tap zoom toggle)
> - Swipe gestures for next/previous herdr tab (opt-in)"

Ask only what can't be detected:

**Agent Watcher (0 questions):** proceed straight to config generation unless the user mentioned custom bindings.

**Remote Dev (0–1 questions):**
> "Do you want auto-zoom when you open herdweb on your phone? This zooms the current pane to full screen."

**Newcomer (0 questions):** defaults are great to start with.

### Phase 4: Generate config

#### Generate `herdweb.config.ts`

Export a plain config object — only include keys that differ from defaults. **Do not** `import { defineConfig } from 'herdweb'` — the CLI calls `defineConfig()` internally.

```typescript
export default {
  // Only non-default overrides here
}
```

Place at `~/.config/herdweb/herdweb.config.ts` (XDG location) unless the user prefers elsewhere.

Validate by starting herdweb:

```bash
herdweb serve --port 18765 -- /bin/true
```

A zero exit means the config loaded cleanly. For a custom path:

```bash
herdweb serve --config /path/to/herdweb.config.ts --port 18765 -- /bin/true
```

See [Config reference](#config-reference) below.

Default herdr drawer uses these button IDs (shipped defaults):

| `id` | `label` | `action` |
|------|---------|----------|
| `herdr-new-window` | + Win | `send` `\x02c` |
| `herdr-split-v` | Split \| | `send` `\x02v` |
| `herdr-split-h` | Split — | `send` `\x02-` |
| `herdr-zoom` | Zoom | `send` `\x02z` |
| `herdr-workspaces` | Spaces | `send` `\x02w` |
| `herdr-sidebar` | Sidebar | `send` `\x02b` |
| `herdr-scrollback` | Scroll | `send` `\x02e` |
| `herdr-kill-pane` | Kill | `send` `\x02x` |
| `herdr-help` | Help | `send` `\x02?` |
| `herdr-prefix` | Prefix | `send` `\x02` |

### Phase 5: Deploy and wrap up

#### Deployment

```bash
which tailscale
```

**If Tailscale installed:** recommend Tailscale Serve. Read `references/tailscale-serve.md`.

**If no Tailscale:** offer Tailscale Serve, Cloudflare Tunnel, or local network options.

herdweb is a remote-control surface — never expose it to the public internet without separate access controls.

#### Security hardening

- Binds `127.0.0.1` only by default
- Content-Security-Policy scoped to same host
- WebSocket origin validation
- X-Frame-Options DENY

For macOS users, mention `--no-sleep` and `references/keep-awake.md`.

#### Push notification onboarding

After deployment and PWA install, walk the user through herdweb’s Web Push subscription (no extra app):

1. **Open the panel**: toolbar **☰** (drawer) → drawer button **🔔** → **Notifications** panel.
2. **iOS first**: if not already in standalone PWA mode, add herdweb to the Home Screen
   (Share → Add to Home Screen). Safari tabs cannot subscribe — the panel shows this hint when
   `display-mode` is not standalone.
3. **Subscribe**: enable **Push notifications**, accept the browser permission prompt. Status should
   show `Subscribed`.
4. **Verify**: tap **Send test notification**. A system notification should arrive; tapping it should
   focus or open herdweb.
5. **History**: scroll to **历史** in the same panel to confirm the test event appears (refresh if needed).

**Troubleshooting (one line)**: if subscribe or test fails, check
`~/.local/state/herdweb/{port}/vapid.json` exists and is readable, and
`push-subscriptions.json` lists your device after subscribing (port = herdweb listen port, e.g. `7681`).

Mention realistic delays: herdweb’s silence lane is ~3–5 minutes after output stops; badge-lane kinds
(`asking`, `done`, `ci-red`) need agent-config outbound wiring ([agent-config#495](https://github.com/zlxlabs/agent-config/issues/495)) and are **not** available until that lands — do not promise 60–90s agent alerts yet.

#### Summary

Tell the user:
1. What was configured and why
2. How to start: `herdweb serve` (default command: `herdr --session default`)
3. How to access from their phone
4. PWA install: Add to Home Screen (required on iOS for push)
5. Built-in controls: font size, scroll, combo picker, help overlay, d-pad, keyboard sovereignty, voice composer, image upload, push notifications (☰ → 🔔)
6. This is a starting point — run this skill again to tweak

---

## Config reference

### Allowed root keys

```
name  theme  font  toolbar  drawer  gestures  mobile  floatingButtons  scrollButtons  pwa  reconnect  asr  notify
```

### ButtonAction union

| `type`           | Required fields     | Notes |
|------------------|---------------------|-------|
| `send`           | `data: string`      | Optional `keyLabel?: string` for help overlay |
| `prefix`         | `data: string`      | Sends prefix byte then opens combo picker |
| `ctrl-modifier`  | (none)              | Opens Ctrl+key combo UI |
| `paste`          | (none)              | Paste from clipboard |
| `combo-picker`   | (none)              | Opens Ctrl/Alt + key modal |
| `drawer-toggle`  | (none)              | Opens/closes command drawer |
| `font-size`      | `delta: number`     | Adjust terminal font size |
| `help`           | (none)              | Opens the help overlay |
| `keyboard-toggle` | (none)             | Toggles the soft keyboard |
| `dpad-toggle`    | (none)              | Toggles floating d-pad |
| `voice-input`    | (none)              | Toolbar-only voice composer entry |
| `image-upload`   | (none)              | Upload image to server tmp dir |
| `notify-panel`   | (none)              | Opens push notification settings panel (drawer placement) |

### Notify (push notifications)

State files are per listen port: `~/.local/state/herdweb/{port}/` (`vapid.json`, `push-subscriptions.json`, `events.jsonl`, `last-session.json`). Production `7681` and debug `7691` must not share a directory.

| Field | Default | Notes |
|-------|---------|-------|
| `notify.token` | unset | Optional bearer token for `POST /api/events` and push subscribe/delete (loopback-only callers) |
| `notify.vapid.subject` | auto | VAPID subject URI; override when rotating keys |
| `notify.vapid.publicKey` | auto | VAPID public key (base64url); stored in state if unset |
| `notify.vapid.privateKey` | auto | VAPID private key; keep in `.local` config when overriding |
| `notify.history.limit` | `200` | Max events retained in `events.jsonl` (lazy trim) |
| `notify.silence.enabled` | `true` | Internal “output went quiet” lane |
| `notify.silence.busyMs` | `30000` | Trailing window to detect busy output (ms) |
| `notify.silence.quietMs` | `180000` | Quiet period after busy before firing (ms) |
| `notify.silence.cooldownMs` | `600000` | Per-session cooldown between silence notifications (ms) |

`POST /api/events` is loopback-only. Badge kinds `asking`, `done`, `ci-red` require an on-host event source (agent-config#495) — not active until that outbound lane is deployed.

### Gestures

| Field | Default | Notes |
|-------|---------|-------|
| `gestures.swipe.enabled` | `false` | Opt in for tab switching |
| `gestures.swipe.left` | `'\x02n'` | Next herdr tab |
| `gestures.swipe.right` | `'\x02p'` | Previous herdr tab |
| `gestures.swipe.leftLabel` | `Next herdr tab` | Help overlay label |
| `gestures.swipe.rightLabel` | `Previous herdr tab` | Help overlay label |
| `gestures.pinch.enabled` | `false` | |
| `gestures.scroll.enabled` | `true` | |
| `gestures.scroll.strategy` | `'wheel'` | `'wheel'` or `'keys'` |
| `gestures.doubleTap.enabled` | `false` | Double-tap zoom toggle |
| `gestures.doubleTap.data` | `'\x02z'` | Default: zoom toggle |

### Mobile

| Field | Default | Notes |
|-------|---------|-------|
| `mobile.initData` | `null` | Sent once on mobile load below `widthThreshold` |
| `mobile.widthThreshold` | `768` | px |
| `mobile.keyboardMode` | `'auto'` | `'auto'` or `'manual'` |

### ASR voice input

Keep API keys in `herdweb.config.local.ts`. Requires HTTPS (except localhost).

### Composing herdr key sequences

herdr shares tmux's Ctrl-B prefix. Bindings that differ from stock tmux:

```
Ctrl-B + v  ->  '\x02v'   (split side-by-side)
Ctrl-B + -  ->  '\x02-'   (split stacked)
Ctrl-B + w  ->  '\x02w'   (workspace picker)
Ctrl-B + b  ->  '\x02b'   (toggle agent sidebar)
Ctrl-B + e  ->  '\x02e'   (edit scrollback)
Ctrl-B + g  ->  '\x02g'   (goto picker)
Ctrl-B + q  ->  '\x02q'   (detach)
```

Shared bindings: `\x02c` (new tab), `\x02n`/`\x02p` (next/prev tab), `\x02z` (zoom), `\x02x` (kill), `\x02?` (help).

## Example configs

### Minimal

```typescript
export default {
  name: 'herdr',
}
```

### Agent watcher — auto-zoom + floating button

```typescript
export default {
  name: 'agents',
  mobile: {
    initData: '\x02z',
  },
  floatingButtons: [
    {
      position: 'top-left',
      buttons: [
        {
          id: 'zoom',
          label: 'Zoom',
          description: 'Toggle pane zoom',
          action: { type: 'send', data: '\x02z' },
        },
      ],
    },
  ],
}
```

### herdr drawer defaults (explicit)

```typescript
export default {
  name: 'herdr',
  drawer: {
    buttons: (defaults) => [
      ...defaults.filter(
        (b) => !['tmux-split-vertical', 'tmux-split-horizontal', 'tmux-sessions', 'tmux-windows', 'tmux-copy'].includes(b.id),
      ),
      { id: 'herdr-split-v', label: 'Split |', description: 'Split pane side-by-side (prefix + v)', action: { type: 'send', data: '\x02v' } },
      { id: 'herdr-split-h', label: 'Split —', description: 'Split pane stacked (prefix + -)', action: { type: 'send', data: '\x02-' } },
      { id: 'herdr-workspaces', label: 'Spaces', description: 'Open workspace picker (prefix + w)', action: { type: 'send', data: '\x02w' } },
      { id: 'herdr-sidebar', label: 'Sidebar', description: 'Toggle agent sidebar (prefix + b)', action: { type: 'send', data: '\x02b' } },
      { id: 'herdr-scrollback', label: 'Scroll', description: 'Edit scrollback (prefix + e)', action: { type: 'send', data: '\x02e' } },
    ],
  },
  gestures: {
    swipe: {
      enabled: true,
      leftLabel: 'Next herdr tab',
      rightLabel: 'Previous herdr tab',
    },
  },
}
```

Start with `herdweb serve` (default: `herdr --session default`).

## Guardrails

- **Do not `import` from `'herdweb'`** in config files — export a plain object
- **Use `drawer.buttons`, never `drawer.commands`**
- **`send` actions require `data`**
- **`floatingButtons` is an array of groups** — `{ position, buttons }`
- **`mobile.initData`** is `string | null`

## Validation

```bash
herdweb serve --port 18765 -- /bin/true
```

Fix any reported paths before proceeding.
