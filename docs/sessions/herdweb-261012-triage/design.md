# DESIGN-note：#147/#178 现状收敛与两条有边界的接入/诊断路线

> 落盘时间 2026-10-12；基线 `1e6619837fa42b1b76ce87049172201fab215ef1`。
> 本文件是 Pi 主脑审定对象；未实施任何应用代码、测试、工作流或平台改动。

## 目标

把两条存量 issue 从「历史断言当事实」变成「最新主干上的可判事实」，并给主脑两条最小、
可独立交付的下一步：#178 一张本仓接入卡（真实 Actions 主审 + 可访问 UI 证据），#147 一张
有边界的最小诊断卡（先拿到确定的因果，再谈修）。用户能看见的结果是：#178 合并后可撤掉
`AGENTS.md` 的录屏豁免，#147 的「静默吞键」断言要么被证据关掉、要么被定位到具体来源。

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
  2. #147 先只补「确定性重现前驱条件」：用已有 `tests/playwright/weak-network.spec.ts` 的
     WebSocket 探针，在长按窗口内强制 close/reopen，断言当前 fail-closed 行为，并把
     「0 字节 + 一条 notice」的真实 producer 帧落成常驻断言。行为改动等诊断卡给出因果后再派。
- **已否决**：
  - 调大 timeout / retries / skip 装绿——卡面锁定项，且会把 1/10 变成不可见。
  - 自动重放被丢弃的按键（缓冲队列）——断线期间无法证明按键的 target 语义，重放可能把
    命令发到另一个 target；需要产品拍板，不由执行器默认。
  - 用 `lastFailureReason` 保留来「顺便修好」#147——现有 e2e 诊断的 `statusLog` 已在每次
     状态变化时记下 reason，产品字段是否要留属于独立语义变更，不属于诊断卡。
  - 复制 gate-hub 的 ui-visual 模板或自己写发布 action——平台明文「通用发布半全 org 共享，
    别拷」。
  - 跨仓改 gate-hub registry/runner/安全策略——本卡无跨仓写权，且现状已满足。

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
   `@refs/tags/v2`，空串不算转发。锁定位置：`zlxlabs/gate/.github/workflows/gate-v2-disposition.yml`
   的 `workflow_dispatch.inputs`；本仓侧锁在 `gate-disposition.yml` 的 `with:` 块。
5. [实测] `gate.yml` 的 workflow `name:` 与 job id 必须都叫 `gate`（required status check 上下文
   `gate / gate` 不能变）。锁定位置：`gate-hub/.github/workflows/gate.yml` 顶部注释所述契约；
   本仓接入卡照抄，不得改名。
6. [实测] dpad 按压的守卫按 **target id** 相等判定，attachment 换代不取消进行中的按压。
   锁定位置：`src/controls/dpad.ts` 的 `startPress` 捕获 `term.getCurrentTargetId()` 与
   `pressStillCurrent`；测试 `tests/dpad.test.ts`「same target + new attachment mid-long-press
   still fires the hold action」。本轮未改该处。
7. [实测] `attach-committed` 会把 `lastFailureReason` 置 `null`（`src/client-entry.ts`
   `case 'attach-committed'`）。锁定位置：该赋值 + `tests/client-connection.test.ts`
   「a snapshot clears failures and restores the one-second backoff」断言 `lastFailureReason: null`。
   本轮未改；#147 诊断卡不得顺手改它（改它就是独立语义变更，须单独立卡）。
8. [实测] 非 synced 窗口内的 input 不发送，只发一次去重的
   `herdweb-connection-notice`（`send()` / `showNotSentNotice()`，消费方是 `src/reconnect.ts` 的
   `setupReconnect`）。锁定位置：`src/client-entry.ts` 的 `send()` 与
   `tests/client-connection.test.ts`（断言 `notice === 'Not sent — still syncing.'`）。

## 待验证前提

1. [推断] 自托管 `ci` 池镜像已预装 Playwright chromium 系统库与浏览器缓存卷，
   且能构建本仓依赖（`node-pty` 原生模块 + `ttyd`）。入口：`gate-v2.yml` 的 quality job 首次
   真实运行；若报缺浏览器/缺 ttyd，属平台镜像容量问题 → 在 gate-hub 提 issue，不在本仓绕过。
2. [推断] `scripts/gate-quality` 在 `ci` 池上的耗时可接受（`quality` job 有 45 分钟输入预算）。
   入口：接入卡合并后的首个真实 run 的 `quality` job 时长。
3. [推断] #147 的 webkit 侧历史签名（socket 断开 + 按压未落按钮）在本机不可复现的原因，
   是本机负载/时序不同还是代码已变。入口：诊断卡在 webkit-iphone 上强制 close/reopen 后
   记录是否仍出现「按钮事件全 0」。
4. [推断] `has_ui: true` 会在 gate-v2 内触发 UI 证据要求的具体形态（shadow 明确不镜像
   `has_ui`，gate-v2 有该输入）。入口：接入卡合并后读一次 `gate / gate` run 的 job 列表。

## 验收路径

1. #178 入口：`gh pr list -R zlxlabs/herdweb` 打开接入 PR，`gh run view <run-id>`。
2. 步骤：① `gate / gate` check 在 **ready（非 draft）** PR 上真实执行且 `primary` job 不为
   SKIPPED；② PR 上出现 `ui-evidence` 状态评论，点进去的报告可打开且标题含完整 40 位 head SHA；
   ③ 合并后 `AGENTS.md` 的 `ui-evidence-exempt` 已删除。
3. 预期：三条同时成立才算接入完成；缺任一条按原豁免保留。
4. #147 入口：`env -u CI TMPDIR=/tmp ./node_modules/.bin/playwright test
   tests/playwright/weak-network.spec.ts --project=webkit-iphone --workers=1 --retries=0`。
5. 步骤：诊断卡的用例在长按窗口内强制 socket close，断言 producer 帧与 PTY 探针输出。
6. 预期：输出能唯一区分「按压没落按钮」「落按钮但被 send 守卫丢」「发了但 PTY 没回显」三者之一。
