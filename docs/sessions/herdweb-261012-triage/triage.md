# 分诊记录：#147 / #178（在最新主干上重跑）

- 基线：`1e6619837fa42b1b76ce87049172201fab215ef1`（2026-10-12，与 `git ls-remote origin refs/heads/main` 一致）
- 环境：20 vCPU；跑前 `/proc/loadavg` = `3.18 4.77 10.36`；未杀任何他人进程
- 复跑工具链：`env -u CI TMPDIR=/tmp ./node_modules/.bin/playwright`（`--workers=1 --retries=0 --reporter=json`，
  `DPAD_DIAG_FORCE=1` 让每个 case 都产出 `[dpad-diag]` 六段）
- 原始结果缓存：`/tmp/herdweb-261012-triage-dlg95b94d/raw/*.json`（四个 JSON + `.exit` + `.err` + `runs.log`）；
  取回方式：执行器会话内 `python3 -c "import json;..."` 或 `jq '.stats' <file>` 直接读，单文件均 < 1 MiB。
  长期引用只引用本仓内摘要，不引用本 worktree 路径。

| 文件 | sha256 |
|---|---|
| raw/c-enter.json | `54ee1c1ed10d12af5fb643f590c66d55348941e3ed123b2a7515ca98389509e0` |
| raw/w-enter.json | `63e02b1fc03a1689089ea4b1702bc821828891f3d0c0f047af3e6158f29dea0f` |
| raw/c-right.json | `ba9936d70a4875649307bc378d9b168eb16faa68624cd6779326e1d10093195b` |
| raw/w-right.json | `1266db25e8ce07830dc2d994adef604179330d63318b0fe205919a698defd58a` |
| raw/runs.log | `fd12acf9ad027692bcb16413b9bb618e815b668b86ff33d8ff89910ea4d654d1` |
| raw/preflight.txt | `e7589915f709204d8034bd1de7333edcd868935a87d1fe2b1c7f48043b68e301` |

---

## #147（dpad.spec.ts 长按偶发 0 字节）

### 代码事实（当前 main，逐条带位置）

| 事实 | 位置 | 与历史断言的关系 |
|---|---|---|
| 按压守卫按 **target id** 比对，不是 attachment 换代 | `src/controls/dpad.ts` `startPress()` 捕获 `term.getCurrentTargetId?.()`，`pressStillCurrent()` 比对 | 旧断言「长按期间第二次 attach 吞掉按压」已被 PR #202 改掉，本轮不重复修 |
| dpad 节点**不随连接重建** | `src/index.ts:283` 只 `createDpad(...)` 一次并 `appendChild`，重连路径无重建 | 历史 webkit 判词「按压落在被重建的 DOM 上」在当前代码里没有对应机制 |
| 非 synced 窗口的 input **不发送**，只发一次去重 notice | `src/client-entry.ts` `send()` → `showNotSentNotice()`；消费方 `src/reconnect.ts` `setupReconnect` | 与历史 webkit 的 `"Not sent — still syncing."` 一致（该路径真实存在） |
| `attach-committed` 把 `lastFailureReason` 置 `null` | `src/client-entry.ts` `case 'attach-committed'` | 「连 reconnect 为什么发生都查不到」的**产品字段**层面成立；但 e2e 诊断的 `statusLog` 在每次状态变化时已记下当时的 reason（`tests/playwright/dpad-diagnostics.ts` 的 `onConnectionStatusChange` 钩子），所以诊断不需要改产品字段 |
| `failConnection` 的真实来源 | `heartbeat-timeout`（send 守卫、两个心跳 deadline）、`socket-error`（bufferedAmount、onclose）、`socket-closed`、`output-overflow`、`protocol-error`、`snapshot-timeout`（两处）、`client-render-backlog` | 见下表实测：40 个 case 里一次都没触发 |

### 运行事实（最新主干，真实浏览器 + 真实 PTY 探针）

命令（每个 project 一条，`--repeat-each=10`）：

```sh
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 ./node_modules/.bin/playwright test \
  tests/playwright/dpad.spec.ts --project=<chromium-android|webkit-iphone> \
  -g "holding ⏎|holding →" --repeat-each=10 --workers=1 --retries=0 --reporter=json
```

| 轮次 | project | 用例 | n/N | retry | WS close | 单 run 内 >1 次 attach-target | `Not sent` notice |
|---|---|---|---|---|---|---|---|
| c-enter | chromium-android | holding ⏎ | 10/10 | 全 0 | 0 | 0 | 0 |
| w-enter | webkit-iphone | holding ⏎ | 10/10 | 全 0 | 0 | 0 | 0 |
| c-right | chromium-android | holding → | 10/10 | 全 0 | 0 | 0 | 0 |
| w-right | webkit-iphone | holding → | 10/10 | 全 0 | 0 | 0 | 0 |

合计 **40/40 passed，`unexpected: 0`，`flaky: 0`，每 case `retry == 0`**（计数可从
`raw/*.json` 的 `stats` 与逐 `results[].retry` 独立读出）。

每个 case 的真实 producer 证据（强制 dump，`raw/*.json` 的 `results[].stdout`）：

- ⏎ case：`"type":"input","data":"\n"` 帧在帧序里（attach-target → snapshot-applied → ping → resize → input），
  PTY 屏幕出现 `byte-ready0a`；按钮事件 `pointerdown=1,pointerup=1,mousedown=1,mouseup=1,click=1`；
  notice `count: 0`；WS lifecycle 只有一次 `open ws#1`，无 close。
- → case：屏幕出现 `1b5b43` 重复；同一套诊断六段齐全。

⚠️ 判据自检：`matched: false` 出现在 → 用例的 dump 里**不代表失败**——`DpadDiagnostics.expected`
只在标题含 `0a`/`⏎`/`↓` 时赋值，`holding →` 的 `expected` 是空串（`tests/playwright/dpad-diagnostics.ts:52-54`），
所以 `matched:false` 是恒假断言。判定用 `stats.unexpected` 与 `results[].status`，已核对两者一致。

### 结论与建议（给主脑，不代执行）

1. **未复现不等于不存在**：40 个 case 里「长按期间 socket 断开 / re-attach」这个前驱条件
   一次都没出现（0 次 close、0 次二次 attach），所以本轮对 webkit 那条历史签名**没有证伪也没有证实**。
2. 建议**拆掉旧断言**：「chromium 1/10、守卫吞键」已由 PR #202 修复且本轮 10/10 绿，
   建议在 #147 顶楼把它标为已闭合，不要再作为现行事实被下一张卡引用。
3. 建议**保留但收窄** #147 为「按压窗口跨越重连时按键被静默丢弃」这一条，并把观察窗口钉在
   CI（历史 run `36256047180`）而不是本机；未拿到确定性重现前不改行为。
4. 需要用户/主脑拍板的产品行为（不由执行器默认）：非 synced 窗口内的按键是
   **丢弃 + 一次性提示**（现状），还是**排队重放**（本轮已否决默认方案：断线期间无法证明
   target 语义，重放可能发到另一个 target），或**每次丢弃都显式提示**（更吵，且违反去重设计）。

### 可直接贴进 #147 顶楼的 Repro 块

```sh
# 分诊复跑（最新主干 1e661983，40/40 全绿；DPAD_DIAG_FORCE=1 让每个 case 都出六段诊断）
cd <herdweb-worktree> && env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 \
  ./node_modules/.bin/playwright test tests/playwright/dpad.spec.ts \
  --project=chromium-android -g "holding ⏎" --repeat-each=10 --workers=1 --retries=0 --reporter=json
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 \
  ./node_modules/.bin/playwright test tests/playwright/dpad.spec.ts \
  --project=webkit-iphone -g "holding →" --repeat-each=10 --workers=1 --retries=0 --reporter=json
# TMPDIR 必须短：tsx 在 TMPDIR 下开 unix socket，路径超 108 字节会 EINVAL，表现为 beforeEach 超时
```

- 最后确认于 `1e6619837fa42b1b76ce87049172201fab215ef1` / 2026-10-12 / 0/40（四个轮次合计 40 个 case）
- 环境：本机 20 vCPU，load ≈ 3.2；失败态 = 无失败；平台/浏览器缺失不适用（chromium 与 webkit 均实际执行）

---

## #178（接入 gate 主门禁 + UI 录屏发布）

### 当前能力缺口（只读核对）

```sh
# 能力仍缺（本单是能力缺失，不是缺陷）；以下均在 clone 后的仓根执行
ls .github/workflows/ | grep -c '^gate'                              # 0
test -x scripts/gate-quality; echo $?                                 # 非 0 = 未接入
grep -n '^ui-evidence-exempt:' AGENTS.md                              # 命中
gh api /orgs/zlxlabs/actions/runner-groups/1 --jq '{id,name,visibility,allows_public_repositories,restricted_to_workflows}'
gh api /orgs/zlxlabs/actions/runner-groups/4 --jq '{id,name,visibility,allows_public_repositories,restricted_to_workflows}'
```

- `gate.yml` / `gate-shadow.yml` / `gate-disposition.yml` 均 **不存在**（HTTP 404 同源判定，仓本身可读）。
- `scripts/gate-quality` 不存在 → `gate-v2.yml` 的 quality job 会走 legacy 自动检测并打
  `DEPRECATION` warning（`gate-v2.yml:554-561`）。要拿到真实阻断层必须补这个可执行入口。

### 权限与登记（只读权威证据）

| 对象 | 事实 | 取证方式 |
|---|---|---|
| runner group 1 `Default` | `visibility=all`、`allows_public_repositories=true`、`restricted_to_workflows=true`；白名单含 `zlxlabs/gate/.github/workflows/{gate-v2,gate-shadow-v2,gate-v2-disposition}.yml@refs/tags/v2` | `gh api /orgs/zlxlabs/actions/runner-groups/1` |
| runner group 4 `ci` | `visibility=all`、`allows_public_repositories=true`、`restricted_to_workflows=false` | `gh api /orgs/zlxlabs/actions/runner-groups/4` |
| registry | herdweb 条目 `tier: personal / stack: node / runner: self / acceptance_ledger: true / has_ui: true` | 本地 `gate-hub/registry.yaml:690-696`（本地 HEAD `373efbaf…` == 远端 HEAD） |
| 共享 action | `zlxlabs/gate-hub/.github/actions/ui-evidence-publish` 存在，`ui-visual-publish` 已 DEPRECATED | 同上本地 checkout |
| v2 移动标签 | `refs/tags/v2` = `8d4106a44e95c5197eb38ec03ca71cdd76f52524`，与 gate 仓 HEAD 一致 | `git ls-remote --tags origin` |

**推翻了 AGENTS.md 的一处前提**：AGENTS.md 写「herdweb 未入 gate-hub registry.yaml，拿不到
ui-evidence-publish 共享 action」。事实是 registry 已有条目且 `has_ui: true`，共享 action 也在。
真实缺口只有「本仓没有 caller / 没有走查 workflow」。

**仍不能声称的事**：能列组 ≠ 已跑成。旧 403 阻塞已解除，但接入完成度要以真实 Actions 运行判定。

### 公开仓自托管隔离（无需改平台策略）

`gate-v2.yml` 每个 job 的 `runs-on` 三元都要求
`github.event.pull_request.head.repo.full_name == github.repository` 且作者不是
`dependabot[bot]`，否则强制 `ubuntu-latest`；shadow 的 `resolve` job 注释同样写明
「fork PR 永远落不到自托管池」。配合公开仓单人模式四条（外部 fork 运行一律不批准、
禁用 `pull_request_target`/`workflow_run`/`issue_comment`/`pull_request_review*`），
本仓接入**不需要改平台安全策略**，不需要停下上报。

### 结论与建议

- 状态维持 `status:ready` / `priority:P2`（权限前提已解除，卡可执行）。
- 关单谓词（三条同时成立）：① 三个 caller + `scripts/gate-quality` + 走查 workflow 在一个 PR 合入；
  ② **ready（非 draft）** PR 上 `gate / gate` 的 `primary` job 真实执行且非 SKIPPED；
  ③ PR 上 `ui-evidence` 评论里的报告链接可打开、标题含完整 40 位 head SHA；随后删除
  `AGENTS.md` 的 `ui-evidence-exempt`。
- 需要用户拍板的产品/风险行为：自托管 `ci` 池会执行本仓同仓 PR 代码（含 fork 镜像分支），
  这是平台既有模型（registry `runner: self`）；若用户不接受，本卡改成
  `runner: hosted` / `control_runner: github-hosted` 逃生舱，代价是失去 primary 评审的自托管加速。

### 可直接贴进 #178 顶楼的 Repro 块

```sh
# 能力仍缺（本单是能力缺失，不是缺陷）
ls .github/workflows/ | grep -c '^gate'   # 0
test -x scripts/gate-quality; echo $?                                 # 非 0 = 未接入
grep -n '^ui-evidence-exempt:' AGENTS.md                              # 命中
# 权限前提已解除（不再是阻塞）
gh api /orgs/zlxlabs/actions/runner-groups/1 --jq '{visibility,allows_public_repositories,restricted_to_workflows}'
gh api /orgs/zlxlabs/actions/runner-groups/4 --jq '{visibility,allows_public_repositories,restricted_to_workflows}'
```

- 最后确认于 `1e6619837fa42b1b76ce87049172201fab215ef1` / 2026-10-12 / 1/1（结论：能力仍缺，权限已通）
- 平台只读证据取自本地 checkout：`gate-hub` HEAD `373efbaf5ac158fe048826814eedb2330c48c885`、
  `gate` HEAD/v2 `8d4106a44e95c5197eb38ec03ca71cdd76f52524`，两者与远端 default 一致
