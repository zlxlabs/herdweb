# herdweb

Purpose-built Web UI for [herdr](https://github.com/ogulcancelik/herdr) — monitor and drive your coding agents from your phone.

risk-tier: personal

Fork status: this project is forked from upstream [connorads/remobi](https://github.com/connorads/remobi) (independent since 2026-08-20) — not tracking upstream, not published to npm. Focus: optimizing the herdr mobile WebUI experience. See `docs/decisions/2026-08-20-fork-herdr-focus.md`.

## Architecture

Pure TypeScript + DOM API — no framework. Transpiles to JS via tsdown. Bundles a browser client via esbuild and serves it from Node.

## Stack

See `docs/architecture/stack.md`.

## Key Commands

```bash
git config core.hooksPath .hk-hooks  # Run once after clone
pnpm test              # Run all tests
pnpm run test:pw       # Playwright e2e tests (chromium + webkit)
pnpm run check         # Biome lint + format check
pnpm run check:fix     # Auto-fix lint + format
pnpm run lint:knip     # Unused exports/files (CI gate — run locally before marking PR ready)
pnpm run lint:ox       # oxlint (CI gate — run locally before marking PR ready; `check` does NOT cover it)
pnpm run build         # Deprecated legacy command
pnpm run build:dist    # Transpile for publishing (tsdown)
```

## Local Development

See `docs/architecture/local-development.md`.

## Conventional Commits

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) format, enforced by hk commit-msg hook.

- Format: `type(scope): description`
- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`, `style`, `build`, `revert`
- Breaking changes: include a `BREAKING CHANGE:` footer. `!` after type/scope is optional shorthand only and must be paired with the footer because semantic-release major detection relies on the footer.

**Choosing the right type matters** — it controls whether semantic-release publishes to npm:

| Type | Release | When to use |
|------|---------|-------------|
| `fix` | patch | Bug fix **visible to package consumers** (runtime behaviour, CLI output, published types) |
| `feat` | minor | New feature visible to consumers |
| `BREAKING CHANGE:` footer | major | Breaking change to public API; `!` is optional shorthand but not sufficient on its own in this repo |
| `ci` | none | CI/CD workflow changes (GitHub Actions, release config) |
| `chore` | none | Tooling, deps, repo hygiene — anything not shipped to consumers |
| `docs` | none | Documentation only |
| `refactor` | none | Code restructuring with no behaviour change |
| `test` | none | Adding or updating tests |

**NEVER use `fix` for non-consumer-facing changes.** `fix` triggers an npm release — it means a bug fix visible to package consumers (runtime behaviour, CLI output, published types). If the change only affects CI, dev tooling, tests, or repo internals, use `ci`, `chore`, or `test` instead — even if it "fixes" something. When in doubt, ask: "would a consumer notice if this change didn't exist?" If no, it's not `fix`.

## Module Layout

See `docs/architecture/module-layout.md`.

## Publishing

See `docs/architecture/publishing.md`.

## Conventions

- Button actions use discriminated unions (`type: 'send' | 'ctrl-modifier' | 'paste' | 'combo-picker' | 'drawer-toggle' | 'font-size' | 'help' | 'keyboard-toggle' | 'dpad-toggle' | 'voice-input' | 'image-upload' | 'prefix' | 'notify-panel'`)
- Unified control schema: use `ControlButton` for both toolbar and drawer items (optional `section` field is drawer-only — toolbar/floating renderers ignore it)
- Config shape: `drawer.buttons` (not `drawer.commands`)
- Config via `defineConfig()` — typed, with sensible defaults
- Config resolution: `--config` flag → cwd → `~/.config/herdweb/` (XDG fallback; legacy upstream config paths auto-fallback)
- Drawer takes a flat `readonly ControlButton[]` — rendered as a single grid, with a heading row inserted whenever adjacent buttons' `section` changes
- Help overlay is config-driven and must be fail-safe (never break core controls if help fails)
- Mobile viewport handling: see `docs/architecture/mobile-viewport.md`.
- Changelog and versioning are fully automated by semantic-release — do not manually edit `CHANGELOG.md`. Use conventional commit types to control releases: `feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major. Non-release types: `chore:`, `docs:`, `refactor:`, `test:`, `ci:`
- All DOM creation in `util/dom.ts` helpers
- Keyboard state preserved: capture `isKeyboardOpen()` before action, use `conditionalFocus()` after
- Tests use happy-dom for DOM environment (e2e/CLI tests use node environment)
- Agent skill: `.agents/skills/herdweb-setup/SKILL.md` provides AI agents with onboarding and config guidance. When config shape, CLI commands, action types, or validation rules change, update the skill to stay in sync.
- Agent onboarding: when helping a user set up herdweb (not develop it), read `.agents/skills/herdweb-setup/SKILL.md` and follow its workflow.
- Voice input: `{ type: 'voice-input' }` is a toolbar-only voice-composer entry; it opens the second-layer composer, whose internal Mic uses tap-to-toggle. It requires `asr.enabled`, HTTPS (except localhost), and a private `.local` provider key. Drawer/floating placement is invalid.
