# DESIGN-note：#178 本仓接入（#147 收窄为待观察）

> 落盘时间 2026-10-12；基线 `1e6619837fa42b1b76ce87049172201fab215ef1`。
> 本文件是 Pi 主脑审定对象；未实施任何应用代码、测试、工作流或平台改动。
> 第二轮（顾问独立核对后）撤回 #147 的诊断卡：本设计只覆盖 #178 接入卡，#147 的处置见 triage.md。

## 目标

把 #178 的能力缺口从「未接入」变成「一个 PR 内可验收的接线」：本仓落平台标准 caller、
`scripts/gate-quality` 质量入口、一条按本仓工具链适配的 UI 走查流水线，产出真实 Actions 运行
与一条可打开、标题含完整 40 位 head SHA 的 UI 证据链接，随后撤掉 `AGENTS.md` 里那条理由已
过时的录屏豁免。#147 本轮不派实现卡：最新主干 40 次目标用例未复现，按仓规交主脑关单，
历史签名与「0 次前驱」的事实、重开条件保留在 triage.md。

## 非目标

- 不在本轮改 `src/`、`tests/`、`.github/workflows/`、`package.json`、AGENTS.md，也不改
  gate-hub/gate 的 registry、runner 策略、共享 action。
- 不给 #147 编根因：40/40 未复现的条件下不给「已修」结论，也不复活旧断言。
- 不为 #147 做缓冲重放/自动重试类改动（锁定决策）。
- 不把 gate 的 dry-run、列组成功、draft PR 的绿色当接入完成。

## 为什么不是分区 / 删除 / 约定

- **分区**：两条 issue 都不含跨写者共享状态。#147 的失败窗口在单个浏览器标签的
  press→send 管道内，分区（按 target/attachment 隔离）已经被 PR #202 做过一次并生效，
  再分区只会把 0 字节换成「换了分区还是 0 字节」。#178 的多写入者是平台仓，本仓只能提
  issue，不能跨仓分区。
- **删除**：#147 能删的只有「重复修同 target 守卫」这条已合并路径，已在 #202 删掉；
  剩下的 `send()` 静默丢弃窗口不能删——它是断线时不误发字节的物理约束，删掉等于把按键
  发到一个已经换代的 attachment 上。#178 也不能删接入（registry 已 `has_ui: true`，
  删了就与登记事实不一致）。
- **约定**：#147 若靠「约定「重连时不要按键」」消解，等于把平台缺陷转嫁给用户，且无法
  验证是否生效（没有观测面）。#178 的平台契约（caller inputs、@v2 移动标签、八项转发）
  已经是硬约定，照抄即可，无需再造约定层。

## 方案要点与已否决方案

- **要点**：
  1. #178 走「复用平台 caller/共享 action」路线：仓内只放三个 caller
     （`gate.yml` / `gate-shadow.yml` / `gate-disposition.yml`）+ 可执行 `scripts/gate-quality`
     + `*_visual.yml` 走查胶水；发布半用
     `zlxlabs/gate-hub/.github/actions/ui-evidence-publish@main`，一个字都不复制。
     自托管隔离不需要新策略：`gate-v2.yml` 的每个 job `runs-on:` 三元已把 fork PR 和
     dependabot 强制降级到 `ubuntu-latest`。
  2. #147 不派实现卡：本轮没有任何因果证据（40 次目标用例里前驱条件 0 次出现）。造一个
     「长按窗口内主动断线」的测试只会把当前行为锁成不变式、并不定位任何东西；真要再查，
     前提是先在真实 CI 或真实触屏再命中一次，按 triage.md 的重开条件取证。
- **已否决**：
  - 调大 timeout / retries / skip 装绿——卡面锁定项，且会把 1/10 变成不可见。
  - 自动重放被丢弃的按键（缓冲队列）——断线期间无法证明按键的 target 语义，重放可能把
    命令发到另一个 target；在拿到真实命中样本与因果之前不改行为（锁定决策）。
  - 为 #147 造主动断线 / 缓冲重放测试把现状锁成不变式——没有因果证据时锁现状只会让后续
    真实命中更难与人为注入区分；弱网下「不自动重放已发命令」按当前文档契约保持原样。
  - 复制 gate-hub 的 ui-visual 模板或自己写发布 action——平台明文「通用发布半全 org 共享，
    别拷」。
  - 跨仓改 gate-hub registry/runner/安全策略——本卡无跨仓写权，且现状已满足。

## 机制预算（最小集，不多造一层）

1. 三个标准 caller（`gate.yml` / `gate-shadow.yml` / `gate-disposition.yml`）：照抄平台模板，
   不写变体。第二消费者是平台自己的 caller 模板与 fleet 里其它已接入仓，本仓只是又一个实例。
2. `scripts/gate-quality`：内容只有 `exec pnpm run ci-check`，不选子集、不加 retry/skip。
   第二消费者是本仓 `ci.yml` 的 check job（跑同一条命令）——所以它是「给共享 quality 一个
   稳定入口」，不是新增一道质量检查；`ci.yml` 今天已经有真实阻断测试（vitest + test:pw +
   biome + oxlint + typos + knip + publint + tsc + deploy）。
3. UI 走查胶水（`herdweb-visual.yml` + `tests/playwright/herdweb-visual.spec.ts` +
   `playwright.visual.config.ts`）：唯一消费者是这条走查流水线，单消费者仍必要——共享
   `ui-evidence-publish` action 只发 PR 评论、不搬运文件，产出 report 的那一半必须留在项目里；
   用例与配置必须与阻断层分开，否则录像、宽限时序、单浏览器这些走查要求会漏进 `ci-check`。
4. 契约测试 `tests/gate-onboarding.test.ts`：唯一消费者是 vitest，仍必要——caller YAML 是本仓
   唯一的接线产物，没有第二个地方会检查它；它读真实 caller 文件与平台模板/契约 fixture 当
   producer 基准，不在测试里手造一份八项输入再断自己。

## 关键不变式

1. [实测] 公开仓 fork PR 永远落不到自托管池：`zlxlabs/gate/.github/workflows/gate-v2.yml`
   每个 job 的 `runs-on` 都带 `github.event.pull_request.head.repo.full_name ==
   github.repository` 且排除 dependabot 的三元（v2 = `8d4106a44e95c5197eb38ec03ca71cdd76f52524`，
   `git ls-remote --tags` 核对）。锁定位置：该文件 `runs-on:` 行本身；本仓侧锁在接入卡新增的
   e2e/CI 检查「本仓三个 caller 不出现危险触发器」。
2. [实测] 仓自有 `ci.yml` 只用 GitHub-hosted runner（`zlxlabs/herdweb` `.github/workflows/ci.yml`
   三个 job 均 `runs-on: ubuntu-latest`），符合公开仓单人模式第 3 条。锁定位置：该文件；
   接入卡不得改它的 runner 行。
3. [实测] 触发器白名单：本仓只允许 `pull_request` / `push` / `workflow_dispatch` /
   `schedule`；平台公开仓清单禁止 `pull_request_target`、`workflow_run`、`issue_comment`、
   `pull_request_review(_comment)`（`gate-hub/docs/guides/public-repository-silo.md`）。
   锁定位置：接入卡三个 caller 的 `on:` 块 + 平台文档给出的 fail-closed 审计命令。
4. [实测] disposition 必须转发八项输入（`pr_number`、`primary_run_id`、`primary_run_attempt`、
   `finding_id`、`reason`、`disposition`、`counterevidence_json`、`tracking_issue`），跟随
   `@refs/tags/v2`。判定「转发」= `with:` 块里逐项出现 `${{ inputs.<name> }}` 原样表达式；
   平台把 `disposition` / `counterevidence_json` / `tracking_issue` 声明为 `required: false`，
   这三项取空串是合法输入，**不**构成漏转发。锁定位置：`gate-v2-disposition.yml` 的
   `workflow_call.inputs` 与平台 caller 模板 `gate-hub/templates/caller-disposition-ci.yml`；
   本仓侧锁在 `gate-disposition.yml` 的 `with:` 块。
5. [实测] `gate.yml` 的 workflow `name:` 与 job id 必须都叫 `gate`（required status check 上下文
   `gate / gate` 不能变）。锁定位置：平台 caller 模板 `gate-hub/templates/caller-ci.yml`
   （`name: gate` + `jobs.gate`）；本仓接入卡照抄，不得改名。

## 当前实现事实（记录用：允许后续单独立卡修改，不是不得改的不变式）

下面几条是 #147 所在代码的现状。本设计不对它们作永久承诺，也不用测试把它们锁死。

1. [实测] dpad 按压守卫按 **target id** 相等判定，`startPress` 捕获
   `term.getCurrentTargetId?.()`、`pressStillCurrent()` 比对（`src/controls/dpad.ts`）。
   锁定位置：`tests/dpad.test.ts`「same target + new attachment mid-long-press still fires
   the hold action」。「点按在 attachment 换代时被吞」是**未实测的候选**，不是已确认机制。
2. [实测] dpad 节点只在 `src/index.ts:283` 创建一次，重连路径不重建 DOM。历史判词里的
   「按压落在被重建的 DOM 上」在当前代码里没有对应机制，不作为后续排查的前提。
3. [实测] 非 synced 窗口内的 input 不发送，并发一次去重的 `herdweb-connection-notice`
   （`src/client-entry.ts` 的 `send()` / `showNotSentNotice()`，消费方 `src/reconnect.ts` 的
   `setupReconnect`）。这是**带提示的丢弃**（`notice === 'Not sent — still syncing.'`），
   不是静默丢键；弱网下不自动重放已发命令是当前文档契约。
4. [实测] `attach-committed` 会把 `lastFailureReason` 置 `null`（`src/client-entry.ts`
   `case 'attach-committed'`），既有断言在 `tests/client-connection.test.ts`。该字段是否保留
   属独立语义变更，不在本设计范围内。

## 待验证前提

1. [推断] 自托管 `ci` 池镜像已预装 Playwright chromium 系统库与浏览器缓存卷，
   且能构建本仓依赖（`node-pty` 原生模块 + `ttyd`）。入口：`gate-v2.yml` 的 quality job 首次
   真实运行；若报缺浏览器/缺 ttyd，先核实平台前置，再去 gate-hub 提 issue，不在本仓绕过。
2. [推断] `scripts/gate-quality`（即 `pnpm run ci-check`）在 `ci` 池上的耗时可接受
   （`quality` job 有 45 分钟输入预算）。入口：接入 PR 上首个真实 run 的 `quality` job 时长。
3. [推断] #147 历史 webkit 签名需要「按压窗口内 socket 断开」，本机 40 次一次未发生；真实 CI
   或真实触屏是否会命中未验证，本轮不为此造测试。入口：真实命中时按 triage.md 的重开条件取证。
4. [推断] `has_ui: true` 在 gate-v2 内触发 UI 证据要求的具体形态（shadow 明确不镜像该输入）。
   入口：接入 PR 的 `gate / gate` run 的 job 列表。
5. [推断] 公开仓可能拿不到平台 Silo 凭据：org secret `SILO_ACCESS_KEY` / `SILO_SECRET_KEY`
   的 visibility 是 `private`（`gh secret list --org zlxlabs`），而 `zlxlabs/herdweb` 是
   PUBLIC；`gate-v2.yml` 的 `Upload canonical primary audit` 以 `if: always()` 运行且缺 key 时
   `exit 1`。若成立，本仓 primary 会在上传步骤以 `SILO_ACCESS_KEY 未传入` 显式失败。
   入口：接入 PR 首个真实 run 的 `primary` job 日志；出现即停下上报（凭据授权缺口），
   不在本仓改 callee、不改 runner 归属。
6. [未知] UI 走查直传 PWRS 需要 repo secret `PWRS_REPORTER_TOKEN`
   （平台模板 `templates/ui-visual/workflow.yml:181`），本仓当前没有任何 repo secret。
   入口：走查 job 的 reporter CLI 报缺 token / 401。

## 验收路径

1. 入口：`gh pr list -R zlxlabs/herdweb` 打开接入 PR，`gh run view <run-id>`——**合并前**就要
   看真实规模与耗时（quality job 时长、自托管池能否装浏览器、走查报告体积），不推到合并后。
2. 步骤：① `gate / gate` check 在 **ready（非 draft）** PR 上真实执行，`primary` job 按 job 级
   `conclusion` 读（SKIPPED 不算通过）；② 同一 PR 上出现 `ui-evidence` 状态评论，点进去的报告
   可打开且标题含完整 40 位 head SHA；③ ①②同时成立后才删 `AGENTS.md` 的 `ui-evidence-exempt`。
3. 预期：①②缺任一条按原豁免保留并在报告写明缺哪条；接入完成不等于分支保护已配置 required check。
   #147 的验收归口是主脑的关单 / 重开裁决（triage.md），本设计不派实现卡。
