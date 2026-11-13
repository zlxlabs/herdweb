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
| `template-ui-visual-upload-step.yml` | zlxlabs/gate-hub `templates/ui-visual/workflow.yml` — two slices: upload step (lines 177–190 of the frozen `d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4` revision, blob `1a184b6af6646eab6cb7f80daf4297897ef8587f`, whole file 9524 B, sha256 `5fa93c05234f74bd98d9a5c6dbfb4902e3398359491394255bd22618419e9a2f`) + publish step (lines 195–202 of the current post-#1508 revision, main `71d90712a2cdeb3f684663133bb20896fddc2bf2`, blob `8c93d6843b7fc8f8c477e228d6c02c90105e49a3`, verified 2026-10-15 via contents API) | `d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4` (upload) / `71d90712a2cdeb3f684663133bb20896fddc2bf2` (publish) | `1aabbda77a9cfd82e359412901de6212f57520cf331ae4632cc9e4885aa8cc12` (combined file; frozen upload-slice-only hash was `9b75a98ff895550a343392ab7d25e527bdf0bea174dcd8bf4b95f22b176c99e6`) |
| `gate-v2-workflow-call-inputs.yml` | zlxlabs/gate `.github/workflows/gate-v2.yml` `workflow_call.inputs` — the `quality_prepare_mise` input entry incl. its gate#314 comment (byte-exact, base indentation kept) | `c44e9e962e94cd2ffc64ccbcf816d700fc7d9a78` (= `refs/tags/v2`, announced in gate#314, verified 2026-10-15 via git ref API; file blob `ecc1fcfb89d59d45ebdf77d950110a51e75306cc`) | `9e937f7caff35b886e39ad70b144b88307726bfe758d45832d694e06626004eb` |

Notes:

- The gate v2 moving tag resolved to `f4213194…` on 2026-10-12; the older
  `8d4106a4…` recorded in `docs/sessions/herdweb-261012-triage/` is historical
  sampling and stays untouched there. Callers follow `@v2`; the resolved SHA is
  evidence only, never pinned in workflow files.
- The disposition callee additionally declares a deprecated `gate_ref` input
  (`required: false`, ignored); the platform caller template deliberately does
  not forward it. Tests assert the eight contract inputs, not `gate_ref`.
- The ui-visual template is registered as a frozen git object, not "latest
  main": `d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4` was origin/main at freeze
  (2026-10-12; a later `ls-remote` the same day observed origin/main advanced,
  which does not affect the frozen baseline). Only the upload step is sliced:
  the template's MagicDNS resolver step is platform-owned bytes and is
  deliberately NOT reproduced in this repo (no duplicate public-scan constant
  hit). Documented adapter deltas vs the slice: report directory
  (`playwright-report` → `test-results/playwright-report`), a prepended
  fail-loud token check, no `working-directory: e2e` (this repo runs from the
  root), upload step `id: upload` with publish gating on
  `steps.upload.outcome == 'success'`, and trusted-event job admission.
  Neither the template nor the adapter declares `shell:` on the step, so
  GitHub's documented Linux default `bash -e {0}` applies; the producer
  boundary test spawns exactly that (no pipefail claim).
- The publish-step slice (added 2026-10-15 from post-#1508 main `71d90712…`,
  blob `8c93d684…`) spans two revisions by design: the frozen `d39ee21…`
  template predates the public action and has no publish step. The current
  template's upload step names its id `upload_evidence` (and drops the
  `environment=ui-evidence` meta); the adapter keeps the frozen upload bytes
  with `id: upload` + meta kept, so the publish slice's `steps.upload_evidence`
  marker maps to the adapter's `steps.upload` — asserted as the only delta.
- The `quality_prepare_mise` fixture is the complete input entry (comment +
  declaration) from the gate#314 release (caller opt-in, default false); the
  callee's consumption guard is not reproduced — it locks the caller-facing
  input contract only.
