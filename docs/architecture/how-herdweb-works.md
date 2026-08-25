# How herdweb works

herdweb is a phone-sized control surface for herdr. One server owns a target registry; each configured
target lazily gets one local PTY-backed `SharedTerminalSession`. A browser renders only the currently
committed target attachment through `xterm.js`.

For transport and lifecycle details, see [Networking and WebSocket flow](networking-and-websockets.md).

## System view

```mermaid
flowchart LR
    Phone[Phone or desktop browser]
    Tunnel[Trusted access layer<br/>Tailscale / VPN / tunnel]
    Server[herdweb server<br/>Hono HTTP + one WS]
    Registry[TargetRegistry<br/>lazy target sessions]
    A[Target A<br/>SharedTerminalSession + PTY]
    B[Target B<br/>SharedTerminalSession + PTY]
    Cmd[herdr or custom command]
    Overlay[herdweb overlay<br/>conditional target picker + controls]
    Xterm[xterm.js<br/>one committed attachment]

    Phone --> Tunnel --> Server
    Server --> Overlay
    Server --> Xterm
    Server --> Registry
    Registry --> A
    Registry --> B
    A --> Cmd
    B --> Cmd
```

## Main pieces

| Piece | Role |
| --- | --- |
| Browser client | Opens one `/ws` and controls its committed attachment |
| herdweb overlay | Adds a target picker when projected `targetCount > 1`, restore state, controls, reconnect handling, and mobile viewport behaviour |
| Hono server | Serves `/`, `/ws`, PWA assets, image-drop, and notification routes |
| `TargetRegistry` | Keeps configured targets and starts each target session lazily; one target exit does not end the server |
| `SharedTerminalSession` | Owns one PTY, mirrors terminal state, and fans output to attachment clients |
| `node-pty` | Spawns the target command on the herdweb host |

Commands and credentials remain server-side. The HTML config projection is allowlisted and includes
`targetCount` so the page can decide whether to create a picker; it does not inject full targets or
argv. Live names, process state, and capability summaries arrive later on the WebSocket `targets`
message, not as part of that projection.

## Runtime boot path

`herdweb serve` bundles the browser client, renders HTML, creates the attachment binding and target
registry, mounts HTTP/WS/notify routes, then listens. No target PTY is required at boot: the default or
selected target is started lazily when its attachment begins.

```mermaid
flowchart TD
    Start[herdweb serve]
    Bundle[Bundle browser JS + CSS]
    Html[Render HTML with client projection and CSP nonce]
    Binding[Create attachment binding]
    Registry[Create TargetRegistry]
    Routes[Create HTTP, WS, PWA and image routes]
    Notify[Mount notification routes and service]
    Listen[Start HTTP server]
    Attach[Browser sends attach-target]
    Spawn[Registry lazily creates SharedTerminalSession]
    PTY[Spawn node-pty target command]
    Mirror[Mirror PTY output into xterm-headless]
    Commit[Snapshot applied; attachment committed]

    Start --> Bundle --> Html --> Binding --> Registry --> Routes --> Notify --> Listen
    Listen --> Attach --> Registry/getOrStart --> Spawn --> PTY --> Mirror --> Commit
```

## Shared vs per-browser state

- A configured target owns one session and can be reused by multiple browsers.
- Each browser has one WebSocket and at most one committed attachment; switching invalidates the old one.
- A new attachment receives a snapshot, drains pending output into xterm, then commits before input opens.
- When a picker exists, the coarse-pointer / phone badge is a direct child of the bottom `#wt-toolbar`;
  the fine-pointer / desktop badge stays top-right. Target picker choice, drafts, reconnect UI, and
  viewport state remain local to the browser.

## Where the code lives

| Area | Notes |
| --- | --- |
| `src/serve.ts` | HTTP/WS routes, registry wiring, attachment routing, headers, and shutdown |
| `src/target-registry.ts` | Lazy target lifecycle and per-target status |
| `src/session.ts` | PTY lifecycle, state mirroring, snapshots, and fan-out |
| `src/session-protocol.ts` | Protocol 2 messages, target summaries, and bounds checks |
| `src/ws-attachment-binding.ts` | Provisional/committed attachment capabilities and input gate |
| `src/client-entry.ts` | One-socket client, target restore/switch, snapshot/commit state machine |

The headless mirror is the server source of terminal screen truth. It lets a new attachment rebuild the
visible screen without asking herdr to replay history, while the target registry keeps other targets lazy.
