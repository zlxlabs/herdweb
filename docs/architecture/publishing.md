# Publishing

> Moved verbatim from `AGENTS.md` on 2026-08-28 (rules slim). Section body below is unchanged.

## Publishing

- Post-fork (2026-08-20): **no npm publishing**. The semantic-release `release` job still maintains version/changelog/GitHub Releases, but npm publish is expected to no-op/fail harmlessly until a new package name is chosen (if ever). Distribution for now = run from source.
- Transpiles to JS via tsdown: `bin` → `dist/cli.mjs`, `exports` → `dist/*.mjs` + `dist/*.d.mts`
- `files` array controls what would be published: `dist/`, `styles/`, `src/pwa/icons/`, `README.md`, `CHANGELOG.md`, `LICENSE`
- CI: `.github/workflows/ci.yml` — pnpm test + biome check
- Release: `release` job in `.github/workflows/ci.yml` — semantic-release on push to `main` and `dev`, gated on `check` job
  - Versioning, changelog, and GitHub Release are automated; npm publish is disabled in practice (fork)
  - `npx semantic-release --dry-run` for local verification
  - Stable channel: `main` → GitHub Release
  - Prerelease channel: `dev` → GitHub prereleases
  - Promote experimental releases by merging `dev` into `main`
  - Release triggers: `feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major
  - No release: `chore:`, `docs:`, `refactor:`, `test:`, `ci:`
- See **Local Development** above for running from source

