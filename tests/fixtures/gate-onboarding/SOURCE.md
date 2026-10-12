# gate-onboarding fixtures: real platform producer bytes + provenance

All fixtures are byte-exact copies/excerpt of the real platform producer files.
Tests in `tests/gate-onboarding.test.ts` read these files (offline, no network,
no dependency on other-repo absolute paths at runtime) as the producer baseline.

| fixture | source | source ref | sha256 |
|---|---|---|---|
| `caller-ci.yml` | zlxlabs/gate-hub `templates/caller-ci.yml` | `0a57417785b3ea80b0d260af7c1feb915873155d` (== origin/main, verified 2026-10-12 via `git ls-remote`) | `4ce3fef5b18a08ba15cc56551bb1edc74ca9497aad5a7b6e6e880ca43b0ab900` |
| `caller-disposition-ci.yml` | zlxlabs/gate-hub `templates/caller-disposition-ci.yml` | `0a57417785b3ea80b0d260af7c1feb915873155d` | `9ee6318f867c9419be30b390fe44d447d341864873de7c17e36713d97d12ed0a` |
| `caller-shadow-ci.yml` | zlxlabs/gate-hub `templates/caller-shadow-ci.yml` | `0a57417785b3ea80b0d260af7c1feb915873155d` | `623eb4d746ec23c48962f5ee4d6e6e55fe8e79b6ce18d475c0fb0635b76be903` |
| `gate-v2-disposition-workflow-call.yml` | zlxlabs/gate `.github/workflows/gate-v2-disposition.yml` lines 15–32 (`workflow_call:` block, inputs + secrets) | `f4213194f162062bc22d57cd6ac5589e97d920af` (= `refs/tags/v2`, == origin/main, verified 2026-10-12 via `git ls-remote`) | `fb82a4957bc3337924e353703dbb5ab8b32939a70b9d14bf34f4f10954b5989d` |
| `gate-v2-quality-entry-detect.yml` | zlxlabs/gate `.github/workflows/gate-v2.yml` lines 548–562 (`Detect repository quality entry` step) | `f4213194f162062bc22d57cd6ac5589e97d920af` | `b79ff876b65faa2af6fcabb43f8801dc929032079453e75f7d9159e0c1b7eed4` |
| `gate-v2-quality-entry-run.yml` | zlxlabs/gate `.github/workflows/gate-v2.yml` lines 608–615 (`Run scripts/gate-quality` step) | `f4213194f162062bc22d57cd6ac5589e97d920af` | `fecd4fb14e1ac49d3aac19293b3c72f8f16412a61a2976a50903e5ff922976d0` |

Notes:

- The gate v2 moving tag resolved to `f4213194…` on 2026-10-12; the older
  `8d4106a4…` recorded in `docs/sessions/herdweb-261012-triage/` is historical
  sampling and stays untouched there. Callers follow `@v2`; the resolved SHA is
  evidence only, never pinned in workflow files.
- The disposition callee additionally declares a deprecated `gate_ref` input
  (`required: false`, ignored); the platform caller template deliberately does
  not forward it. Tests assert the eight contract inputs, not `gate_ref`.
