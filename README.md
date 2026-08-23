<div align="center">
  <img src="logo/logo.svg" width="128" alt="herdweb logo"/>
</div>

# herdweb

**Purpose-built Web UI for [herdr](https://github.com/ogulcancelik/herdr) — monitor and drive your coding agents from your phone.**

herdweb is a mobile-first browser overlay for herdr sessions: swipe between tabs, pinch to zoom, tap to send commands, and keep full terminal power on a 6-inch screen. It is a self-hosted fork of the upstream [connorads/remobi](https://github.com/connorads/remobi) project — independent since 2026-08-20. See [fork decision](docs/decisions/2026-08-20-fork-herdr-focus.md) for background.

## Why herdweb

- **Built for herdr** — drawer buttons, gestures, and defaults match herdr keybindings out of the box
- **Swipe between tabs** — gesture navigation without prefix-key fumbling on a phone screen
- **Pinch to zoom** — resize text like every other app on your phone
- **Install to your home screen** — standalone PWA, looks and feels native
- **Config-driven** — your buttons, your gestures, your layout
- **Self-hosted** — local-first by default; bring your own access layer (Tailscale, Cloudflare, ngrok)

## Requirements

- [Node.js](https://nodejs.org/) ≥ 22
- [herdr](https://github.com/ogulcancelik/herdr) — the agent multiplexer herdweb controls

## Quick start

```bash
git clone <your-fork-url> herdweb && cd herdweb
pnpm install
git config core.hooksPath .hk-hooks   # enable commit hooks (conventional commits, biome)

# Start (spawns herdr, serves herdweb on 127.0.0.1:7681)
pnpm exec tsx cli.ts serve
```

Or build first, then run from `dist/`:

```bash
pnpm run build:dist
node dist/cli.mjs serve
```

Open `http://localhost:7681` on the same machine to verify. For phone access, deploy behind a trusted proxy or tunnel — see [Deploying herdweb](docs/deploy-herdr.md).

herdr captures mouse input by default, so touch scroll and tap-to-focus work with no extra multiplexer configuration.

### Voice composer prerequisites

Voice composer microphone capture requires a secure browser context: use HTTPS on a phone (for
example Tailscale Serve or an HTTPS reverse proxy). `localhost` and `127.0.0.1` are secure-context
exceptions for local development; a plain HTTP LAN address is not. If the browser cannot use
`getUserMedia`, herdweb hides the voice composer entry instead of showing an unusable control.

## Set up with AI

The [herdweb-setup skill](.agents/skills/herdweb-setup/SKILL.md) checks your environment, interviews you about your workflow, generates a validated `herdweb.config.ts`, and walks through deployment — one conversation.

Tell your coding agent:

> Read `.agents/skills/herdweb-setup/SKILL.md` in this repo and follow it to onboard me.

## Security model

herdweb is a remote-control surface for your terminal. Anyone who can reach it can drive the herdr session with your user privileges.

- `herdweb serve` binds to `127.0.0.1` by default.
- The inner PTY-backed terminal session stays local to the herdweb process.
- There is no built-in login, password, or ACL in herdweb itself.
- Safe default: keep it on localhost and publish it through a trusted layer like Tailscale Serve.
- If you use `herdweb serve --host 0.0.0.0`, you are exposing terminal control to your LAN/whatever can route to that port. Do that only if you intentionally want direct network exposure and have separate network controls in place.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## CLI reference

```text
herdweb serve [--config <path>] [--port <n>] [--host <addr>] [--base-path <path>] [-- <command...>]
  Start herdweb with its built-in web terminal and PWA support.
  Default host: 127.0.0.1. Default port: 7681. Default command: herdr --session default
  Example: herdweb serve --host 0.0.0.0 --port 8080
  Example: herdweb serve --base-path /random-token
  Example: herdweb serve --port 8080 -- herdr --session dev

herdweb build [--config <path>] [--output <path>] [--dry-run]
  Deprecated. herdweb no longer patches ttyd HTML.

herdweb inject [--config <path>] [--dry-run]
  Deprecated. herdweb no longer patches ttyd HTML.

herdweb init
  Scaffold a herdweb.config.ts with commented defaults.

herdweb --version
herdweb --help
```

Short flags: `-c` (`--config`), `-p` (`--port`). Legacy deprecated flags: `-o` (`--output`), `-n` (`--dry-run`).

The `--` escape hatch after `serve` lets you override the default command, for example `herdweb serve -- bash --norc` for debugging without herdr.

### Config resolution

When `--config` is not specified, herdweb searches:

1. `herdweb.config.ts` / `.js` in the current directory
2. `~/.config/herdweb/herdweb.config.ts` / `.js` (XDG fallback)
3. Legacy upstream config paths (automatic fallback for migration)

## Configuration

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

All fields are optional — the CLI fills in defaults internally when it loads the config.

### Voice composer input

Voice input is disabled by default. It is a browser-direct Doubao SAUC connection: microphone audio
and the API key stay in the browser-to-provider path, so enable it only for a trusted single-user
self-hosted deployment. Keep the key in the `.local` config file; it is necessarily delivered to
the browser when voice input is enabled.

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

The `voice-input` action is toolbar-only; putting it in `drawer.buttons` or `floatingButtons` is
rejected by config validation.

### Push notifications

herdweb can push Web Push notifications to your phone when agents need attention, when output
goes quiet, or when the service restarts. Subscribe from the in-app panel — no separate app install.

**Prerequisites**

- **Android**: Chrome (or another browser with Web Push + service workers).
- **iOS**: herdweb must be **added to the Home Screen** as a standalone PWA (iOS 16.4+). Safari
  tabs do not expose the Push API — subscription will not work in a normal browser tab.
- **HTTPS** on phones (Tailscale Serve, reverse proxy, etc.). `localhost` / `127.0.0.1` work for
  local dev only.

**Subscribe and test**

1. Open herdweb on your phone.
2. Tap **☰** (drawer) in the toolbar, then **🔔** in the drawer grid.
3. In the **Notifications** panel, enable **Push notifications** and accept the browser permission prompt.
4. Tap **Send test notification** — a system notification should arrive within a few seconds.
5. Tap the notification — herdweb should focus (or open) in the browser/PWA.

On iPhone, if you are not in standalone mode, the panel shows a hint to add herdweb to the Home
Screen first.

**What gets notified (and how fast)**

| Lane | Source | Typical delay | v1 status |
|------|--------|---------------|-----------|
| Silence | herdweb (PTY output stops after busy period) | ~3–5 minutes after agent output stops | Available |
| Health | herdweb (PTY exit / service restart) | Seconds after exit or restart | Available |
| Test | Panel **Send test notification** button | Immediate | Available |
| asking / done / ci-red | External `POST /api/events` (badge lane from agent-config) | ~60–90 seconds when wired | **Not available yet** — requires [agent-config#495](https://github.com/zlxlabs/agent-config/issues/495) on the machine running herdweb |

The silence lane cannot distinguish “waiting for you” from “running a long task” — titles use
“may be done / stuck” wording. A `202` response from `POST /api/events` means the event was
accepted and queued for push — not that the phone has already displayed it.

**State directory (per port)**

Runtime files live under `~/.local/state/herdweb/{port}/` (or `$XDG_STATE_HOME/herdweb/{port}/`).
Production (`7681`) and debug (`7691`) instances use separate directories so VAPID keys,
subscriptions, and event history do not collide.

| File | Purpose |
|------|---------|
| `vapid.json` | VAPID keys (mode `0600`). Auto-generated on first `herdweb serve` if missing; startup logs a one-line hint. |
| `push-subscriptions.json` | Registered device endpoints |
| `events.jsonl` | Event history (`kind=test` events are not persisted) |
| `last-session.json` | Per `herdr --session` key — used for restart / exit health notifications |

Rotate VAPID keys via `notify.vapid.*` in config (see skill / config reference). Old subscriptions
become invalid after a key change — users must re-subscribe.

**Local events API**

`POST {basePath}/api/events` accepts events from **loopback only** (`127.0.0.1` / `::1` /
`localhost`). Optional `notify.token` in config requires matching `Authorization: Bearer …` on
the request. External event sources (e.g. agent-config badge outbound) must run on the **same
machine** as herdweb — cross-host posting is not supported in v1.

Smoke test (with `herdweb serve` on port 7681, after subscribing on a device):

```bash
curl -sS -X POST 'http://127.0.0.1:7681/api/events' \
  -H 'content-type: application/json' \
  -d '{"v":1,"id":"smoke-1","kind":"test","title":"curl smoke","body":"from loopback","ts":'"$(date +%s000)"'}'
```

Expect HTTP `202`. If `notify.token` is set, add `-H 'authorization: Bearer <token>'`.

**Restart behaviour**

When herdweb or the PTY session restarts, the health lane sends **one** notification per incident:
exit notifications on PTY shutdown; a separate “service restarted” notification only if the new
session starts more than 120 seconds after the previous exit (crash-loops inside that window
collapse to a single exit notification).

`gestures.scroll.strategy` controls touch scroll behaviour:

- `wheel` (default): sends SGR mouse wheel events with touch-mapped terminal coordinates.
- `keys`: sends `PageUp` / `PageDown` for app-level paging when preferred.

At runtime, herdweb validates the config object shape and rejects unknown keys with clear path-based errors.

## Guides

- [Mobile pane navigation](.agents/skills/herdweb-setup/references/mobile-panes.md) — zoom-aware swipe, auto-zoom on load, floating buttons
- [Tailscale Serve](.agents/skills/herdweb-setup/references/tailscale-serve.md) — expose over your tailnet with HTTPS
- [Keeping your Mac awake](.agents/skills/herdweb-setup/references/keep-awake.md) — prevent sleep during remote sessions

## Architecture docs

- [How herdweb works](docs/architecture/how-herdweb-works.md) — runtime overview, shared session model, and boot path
- [Networking and WebSocket flow](docs/architecture/networking-and-websockets.md) — request lifecycle, protocol, and network boundary

## Architecture

Pure TypeScript + DOM API — no framework. The build bundles the browser client via esbuild, serves it from Node, and bridges browser input/output to a local PTY via `node-pty`. `xterm.js` handles terminal rendering in the browser; herdweb layers the mobile controls on top.

Key modules:

| Module | Purpose |
|--------|---------|
| `src/toolbar/` | Touch toolbar (single row by default, optional second row) |
| `src/drawer/` | Command drawer with grid layout |
| `src/gestures/` | Swipe, pinch, scroll detection |
| `src/controls/` | Help overlay, combo picker, scroll buttons, floating d-pad |
| `src/theme/` | Catppuccin Mocha + theme application |
| `src/viewport/` | Height management, landscape detection |
| `src/util/` | DOM helpers, terminal, keyboard, haptics |

## Development

```bash
git clone <your-fork-url> herdweb && cd herdweb
pnpm install
git config core.hooksPath .hk-hooks
```

### Running locally

From source (bundles the browser client on the fly via esbuild — no build step needed):

```bash
pnpm exec tsx cli.ts serve              # localhost:7681, default herdr session
```

Or build first, then run from dist/:

```bash
pnpm run build:dist
node dist/cli.mjs serve
```

### Checks

```bash
pnpm test            # vitest (unit + integration)
pnpm run test:pw     # playwright e2e (needs: pnpm exec playwright install chromium webkit --with-deps)
pnpm run check       # biome lint + format
```

## Release channels

- `main` publishes stable GitHub Releases
- `dev` publishes prereleases
- merge `dev` into `main` to promote an experimental line to stable

This fork does not publish to npm. Versioning and changelog are driven by semantic-release on push to `main` and `dev`.

## FAQ

**Is this secure?**
herdweb doesn't handle auth — it's a UI overlay. Use a tunnel or VPN you trust. See [Deploying herdweb](docs/deploy-herdr.md) and [Tailscale Serve](.agents/skills/herdweb-setup/references/tailscale-serve.md). Security is your responsibility.

**Why not Termux / Termius / SSH apps?**
They work, but you're managing SSH keys and fighting a UI that wasn't built for touch. herdweb keeps your herdr workflow and adds touch controls on top.

**Why not chat-based mobile apps?**
Those tools change your workflow. herdweb gives you the raw terminal — full power, self-hosted, works with every agent herdr can host.

**Is this production-ready?**
It's early. The author uses it daily. Feedback welcome.

## Licence

MIT
