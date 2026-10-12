# 分诊进度：herdweb-261012（#147 / #178）

## 里程碑 1：现场与基线核对

- 阶段：planning（本次不改生产代码/测试/工作流）
- 结论：worktree HEAD = `1e6619837fa42b1b76ce87049172201fab215ef1`，与 `git ls-remote origin refs/heads/main` 一致；
  `git status` 除本 session 目录外干净。
- 关键决策：本卡只产出 design / triage / 证据摘要 / 卡草案；AGENTS.md「主干基线」字段为
  `gh api request failed`，**没有基线作业可比**，因此不产出「继承红 / 新红」对比（未能判定）。
- 已否决：不跑全量 `ci-check` 充当基线复现（缺 mise，`lint:typos` 必失败，会伪装成红）。

## 里程碑 2：#147 最新主干真实复跑

- 阶段：debug（串行、`env -u CI`、`--workers=1 --retries=0`、JSON reporter、`DPAD_DIAG_FORCE=1`）
- 结论：chromium-android 与 webkit-iphone 各 10 轮，`holding ⏎` + `holding →` 合计 **40/40 passed**，
  `retry` 全 0；40 个 case 里 **0 次 WS close、0 次单 run 内二次 attach-target、0 次 `Not sent` notice**。
- 关键决策：历史「chromium 1/10」断言已被 PR #202 闭合且本轮不可复现；历史 webkit 签名需要
  「按压窗口内 socket 断开」这个前驱条件，本轮 40 次一次都没发生 → 既不证实也不证伪。
- 踩坑（已解决）：`TMPDIR` 指向 delegate runtime 深路径时，`tsx` 的 IPC unix socket 超长
  （>108 字节）报 `listen EINVAL`，Playwright 表现为 `beforeEach` 30s 超时而非启动失败；
  解法是 `TMPDIR=/tmp`，不是改测试。
- 判据自检：`holding →` 的 dump 里 `matched:false` 是恒假字段（`DpadDiagnostics.expected` 对该标题为空串），
  真正判据是 `stats.unexpected` 与 `results[].status`；两者已交叉核对一致。
- 下一步唯一动作：交两张卡（#178 接入卡、#147 最小诊断卡），由主脑审定后派出。

## 里程碑 3：#178 平台契约核对（只读）

- 阶段：planning
- 结论：三个 caller 全缺、`scripts/gate-quality` 不存在、AGENTS.md 录屏豁免仍在；
  registry 已有 herdweb 条目且 `has_ui: true`，共享 action `ui-evidence-publish` 存在
  → **AGENTS.md 里「未入 registry、拿不到共享 action」的前提已失效**。
- 权限：runner group 1/4 均 `visibility=all` + `allows_public_repositories=true`；
  group1 白名单含 gate v2 三个工作流的 `@refs/tags/v2`；group4 不限工作流。旧 403 阻塞解除。
- 安全：gate-v2 每个 job 的 `runs-on` 三元把 fork PR / dependabot 强制降级到 `ubuntu-latest`，
  **不需要改平台安全策略**；公开仓触发器白名单由本仓三个 caller 遵守。
- 关键决策：不跨仓改 registry / runner / action；平台缺能力时去 gate-hub 提 issue，不在本仓绕过。
- 下一步唯一动作：主脑审定 `cards/gate-onboarding.md` 后派出。

## 时变证据（外部，原文白名单）

```text
group 1: {"allows_public_repositories":true,"id":1,"name":"Default","restricted_to_workflows":true,
          "selected_workflows":[... "zlxlabs/gate/.github/workflows/gate-v2.yml@refs/tags/v2",
          "zlxlabs/gate/.github/workflows/gate-shadow-v2.yml@refs/tags/v2",
          "zlxlabs/gate/.github/workflows/gate-v2-disposition.yml@refs/tags/v2" ...],"visibility":"all"}
group 4: {"allows_public_repositories":true,"id":4,"name":"ci","restricted_to_workflows":false,
          "selected_workflows":[],"visibility":"all"}
registry.yaml:690-696: - repo: zlxlabs/herdweb / tier: personal / stack: node / runner: self /
          acceptance_ledger: true / notify_category: personal / has_ui: true
gate 仓: refs/tags/v2 = 8d4106a44e95c5197eb38ec03ca71cdd76f52524（= gate HEAD）
gate-hub 本地 HEAD = 373efbaf5ac158fe048826814eedb2330c48c885（= 远端 HEAD）
repo visibility: {"isPrivate":false,"nameWithOwner":"zlxlabs/herdweb","visibility":"PUBLIC"}
repo secrets: gh secret list -R zlxlabs/herdweb → 空
org secrets: [{"name":"SILO_ACCESS_KEY","visibility":"private"},{"name":"SILO_SECRET_KEY","visibility":"private"}]
gate-v2.yml:1186-1199: - name: Upload canonical primary audit / if: always() /
          [ -n "${AWS_ACCESS_KEY_ID:-}" ] || { echo "::error::SILO_ACCESS_KEY 未传入" >&2; exit 1; }
模板 templates/ui-visual/workflow.yml:181: PWRS_REPORTER_TOKEN: ${{ secrets.PWRS_REPORTER_TOKEN }}
org 内公开仓：gate、ci-templates 均无 gate caller（无反例证明公开仓能跑通 gate-v2）
```

## 里程碑 4：顾问裁决收口（第二轮，覆盖里程碑 2/3 的「两张卡」建议）

- 阶段：planning；本轮只改本仓文档，未重跑 40 次用例、未动任何远端 issue、未碰应用/测试/CI。
- 覆盖旧建议：只保留一张 #178 接入卡，`cards/dpad-press-reconnect-probe.md` 已删除。
- #147 结论改写：最新主干本机四组各 0/10 未复现 → 按仓规建议主脑**关单**（不是「已修」也不是
  「不存在」）；不复活「DOM 重建」判词（当前代码无该机制）；不把 `Not sent — still syncing.`
  写成静默丢键；重开条件 = 真实 CI / 真实触屏再命中，带新 SHA + dump + 该轮 n/N。
- n/N 口径：表里 10/10 是**通过数**；失败口径四组各 0/10，合计 40/40 仅作同轮汇总，不能代单条 n/N。
- #178 新增事实：org secret `SILO_*` visibility=`private` 而本仓是 PUBLIC，`primary` 的
  `Upload canonical primary audit` 以 `if: always()` + 缺 key 即 `exit 1` → 可能以
  `SILO_ACCESS_KEY 未传入` 显式失败；本仓另无 `PWRS_REPORTER_TOKEN`。两者都是凭据授权缺口，
  接入卡遇到即停下上报，不在本仓塞凭据、不改 callee、不改 runner 归属。
- 卡面修正：Verify-Command=`pnpm run ci-check`；允许/Scope 纳入 `tests/gate-onboarding.test.ts`、
  `tests/playwright/herdweb-visual.spec.ts`、`playwright.visual.config.ts`；新增 Accept-Check 三条；
  转发判据 = `with:` 里逐项出现 `${{ inputs.<name> }}` 原样表达式（可选三项空串合法）。
- 本轮已否决（覆盖旧建议）：#147 诊断卡、主动断线测试把现状锁成不变式、复活 DOM 重建判词、
  把有提示的丢弃写成静默丢键、让用户在丢弃/重放/逐次提示之间三选一、自托管同仓 PR 风险拍板
  （registry 已 `runner: self`，沿既有模型）。
- 下一步唯一动作：主脑审定 `cards/gate-onboarding.md` 后派出；#147 顶楼按 triage.md 的收口短文
  更新并关单。
- 证据不变：`raw/*.json` 六个 sha256 与里程碑 2 相同，本轮未重跑、未修改原始 JSON。

本地 checkout 与远端 default SHA 已逐一核对，陈旧文档只当线索。
