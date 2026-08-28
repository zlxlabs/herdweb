# Module Layout

> Moved verbatim from `AGENTS.md` on 2026-08-28 (rules slim). Section body below is unchanged.

## Module Layout

Browser overlay (bundled to the client via esbuild):

- `src/client-entry.ts` — IIFE entry point esbuild bundles into the served client (wires xterm + WebSocket to the overlay; term bridge implements keyboard suppression via `inputmode="none"`)
- `src/overlay-entry.ts` — alternate IIFE entry that re-exports `init`/`createHookRegistry` from `index` (embedding/coverage entry, not the bundle entry)
- `src/index.ts` — overlay bootstrap: waitForTerm then init overlay
- `src/config.ts` — defaults, defineConfig, deepMerge
- `src/types.ts` — all shared types
- `src/toolbar/` — toolbar DOM + button definitions
- `src/drawer/drawer.ts` — command drawer with sectioned grid (optional `section` headings)
- `src/drawer/commands.ts` — re-exports defaultDrawerButtons from config
- `src/gestures/` — swipe, pinch, scroll detection + gesture lock
- `src/controls/` — help overlay, combo picker, floating buttons, scroll buttons, keyboard controller, d-pad
- `src/controls/keyboard-controller.ts` — keyboard sovereignty: three-signal state controller (`inputPermission`/`textareaFocus`/`keyboardVisible`), escape hatch, fail-loud overlay; also exports the shared touchend focus-steal guard
- `src/controls/dpad.ts` — moshi-style floating key pad (⌫ ↑ 📋 / ← ⏎ → / ⇥ ↓ ⇧⇥), toggled by the ✥ `dpad-toggle` action; keys come from `config.dpad.keys` (null = spacer cell), are focus-safe (touchend guard), and `send` keys go via `sendData` while other action types dispatch through the action registry. Keys with `longPressAction` (default: ⏎ → `'\n'`, newline without submit) fire it on a 500ms hold and suppress the tap; they carry the `wt-dpad-has-alt` corner badge. Keys with `repeatOnHold` (default: ← ↑ ↓ → ⌫) repeat their action after a 300ms hold every 100ms until release (mutually exclusive with `longPressAction` — longPress wins). The slim `⠿` handle above the grid drags the pad (pointer capture, `wt-dpad-floating` switches right/bottom to inline left/top); the position persists in `localStorage` key `herdweb:dpadPosition` (viewport-clamped on apply), and double-tapping the handle docks it back
- `src/controls/image-drop-controller.ts` — `createImageDropController`: two entries — the `image-upload` action's hidden file input and a capture-phase `paste` listener on the terminal textarea (optional `pasteTarget` dep) — POST the image to `{basePath}/api/image-drop`, then insert ` ${path} ` into the agent input (never Enter) once the session is unchanged and synced; text-only pastes fall through to xterm untouched; success is a transient toast (auto-hides after ~2.5s), only failure states show the retry/copy/close panel
- `src/controls/notify-panel.ts` — push notification settings panel (subscribe toggle, test button, iOS standalone hint, event history list); opened via drawer `notify-panel` action (☰ → 🔔)
- `src/controls/target-picker.ts` — target badge + flat picker list; created only when projected `targetCount > 1`. Coarse-pointer badge is a direct child of `#wt-toolbar`; fine-pointer stays top-right.
- `src/theme/` — catppuccin-mocha + apply
- `src/viewport/` — height management, landscape detection
- `src/startup-resize.ts` — schedules the initial terminal resize on load (rAF + fonts-ready)
- `src/reconnect.ts` — connection loss overlay + auto-reload
- `src/util/dom.ts` — element creation helpers
- `src/util/terminal.ts` — sendData, resizeTerm, waitForTerm
- `src/util/haptic.ts` — vibration feedback
- `src/util/keyboard.ts` — isKeyboardOpen, conditionalFocus
- `src/util/toast.ts` — showToast: transient inline-styled status toast (auto-hide ~2.5s); wired into the action registry for fail-loud paste errors
- `src/util/tap.ts` — onTap: touch + click handler for iOS Safari compatibility
- `src/actions/registry.ts` — action dispatch + clipboard
- `src/hooks/registry.ts` — lifecycle hook system
- `src/config-schema.ts` — Valibot validation schemas
- `src/config-resolve.ts` — button array resolution
- `src/config-validate.ts` — config assertions
- `src/asr/` — provider-independent ASR contract, PCM pipeline, AudioWorklet, and Doubao SAUC engine. iOS standalone PWA (`navigator.standalone === true`) keeps the microphone MediaStream alive between `start()`/`stop()` sessions; other environments still fully release on stop. Release happens on controller dispose, page unload, or a dead track (next `start()` rebuilds).
- `src/pwa/` — PWA manifest, meta-tags, icons
- `src/notify/` — Web Push pipeline: event schema, `/api/events` + push subscribe routes, silence/health lanes, per-port state files
- `src/sw-entry.ts` — service worker source (push display, notificationclick focus/openWindow, pushsubscriptionchange); served as `{basePath}/sw.js`, no fetch handler

Server runtime (`herdweb serve`, Node):

- `src/serve.ts` — Hono HTTP + WS server: routes, CSP/origin/host-header checks, icon serving, caffeinate, shutdown
- `src/session.ts` — SharedTerminalSession: node-pty spawn, xterm headless mirror, multi-client broadcast + snapshot
- `src/session-protocol.ts` — client/server message types, parse/serialise, input + resize bounds
- `src/base-path.ts` — URL prefix mounting (`--base-path`), shared by server routes and client
- `src/util/node-compat.ts` — sleep, spawnProcess, collectStream
- `src/util/spawn-helper.ts` — restore node-pty's macOS spawn-helper execute bit at runtime

CLI + build:

- `cli.ts` — CLI: serve, init, deprecated build/inject, --version; config loading (cwd → XDG) + .local overrides
- `src/cli/args.ts` — CLI argument parsing
- `build.ts` — source-runtime overlay bundling (esbuild) + HTML rendering; reads prebuilt `dist/` assets for published installs
- `scripts/build-overlay.ts` — writes the prebuilt `dist/client.iife.js` + `dist/client.css` for publish (`build:overlay`)
- `src/release/commit-message.ts` — conventional-commit parsing (release classification, breaking-footer check)
- `styles/base.css` — all CSS

