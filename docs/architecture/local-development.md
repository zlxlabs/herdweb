# Local Development

> Moved verbatim from `AGENTS.md` on 2026-08-28 (rules slim). Section body below is unchanged. The `docs/deploy-herdr.md` href is repo-root-relative as in the source; from this file the same target is [`../deploy-herdr.md`](../deploy-herdr.md).

## Local Development

From source (bundles overlay on the fly, no build step):

```bash
pnpm exec tsx cli.ts serve                                # localhost:7681, default herdr session
pnpm exec tsx cli.ts serve --port 8080 -- bash --norc     # custom port, escape hatch without herdr
```

From a local build:

```bash
pnpm run build:dist && node dist/cli.mjs serve
```

### Production / Debug

See [docs/deploy-herdr.md](docs/deploy-herdr.md) for systemd unit setup, install scripts, and production/debug deployment.

