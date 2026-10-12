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

实际执行的四条命令（Playwright 的 `-g` 是单值，project × grep 必须拆开跑，故不是一条命令）：

```sh
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 ./node_modules/.bin/playwright test \
  tests/playwright/dpad.spec.ts --project=chromium-android -g "holding ⏎" \
  --repeat-each=10 --workers=1 --retries=0 --reporter=json   # -> raw/c-enter.json
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 ./node_modules/.bin/playwright test \
  tests/playwright/dpad.spec.ts --project=webkit-iphone -g "holding ⏎" \
  --repeat-each=10 --workers=1 --retries=0 --reporter=json   # -> raw/w-enter.json
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 ./node_modules/.bin/playwright test \
  tests/playwright/dpad.spec.ts --project=chromium-android -g "holding →" \
  --repeat-each=10 --workers=1 --retries=0 --reporter=json   # -> raw/c-right.json
env -u CI TMPDIR=/tmp DPAD_DIAG_FORCE=1 ./node_modules/.bin/playwright test \
  tests/playwright/dpad.spec.ts --project=webkit-iphone -g "holding →" \
  --repeat-each=10 --workers=1 --retries=0 --reporter=json   # -> raw/w-right.json
```

工具替换与 TMPDIR 差异：卡面原命令是 `env -u CI pnpm exec playwright test ...`；本机无 mise /
无全局 pnpm，故改为 worktree 内直调 `./node_modules/.bin/playwright`（node_modules 是临时软链到
主checkout，收工已还原），并强制 `TMPDIR=/tmp`（深路径下 tsx 的 IPC unix socket 超 108 字节会
`listen EINVAL`，表现为 beforeEach 超时）。除这两处外参数与原命令一致。

| 轮次 | project | 用例 | 通过数 n/N | retry | WS close | 单 run 内 >1 次 attach-target | `Not sent` notice |
|---|---|---|---|---|---|---|---|
| c-enter | chromium-android | holding ⏎ | 10/10 | 全 0 | 0 | 0 | 0 |
| w-enter | webkit-iphone | holding ⏎ | 10/10 | 全 0 | 0 | 0 | 0 |
| c-right | chromium-android | holding → | 10/10 | 全 0 | 0 | 0 | 0 |
| w-right | webkit-iphone | holding → | 10/10 | 全 0 | 0 | 0 | 0 |

合计 **40/40 passed，`unexpected: 0`，`flaky: 0`，每 case `retry == 0`**（计数可从
`raw/*.json` 的 `stats` 与逐 `results[].retry` 独立读出）。表里 10/10 是**通过数**；
按 issue 顶楼的失败口径，n（失败数）/ N = **0/10**，四组分别如此。合计 40/40 只是这四组的
同轮汇总，不能当成一条 n/N 贴进顶楼（不同 project / 不同 grep / 不同时间窗）。

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
   一次都没出现（0 次 close、0 次二次 attach），所以本轮对 webkit 那条历史签名**既没证实也没证伪**。
2. **建议按仓规关单**：AGENTS.md 写的是「复现不出来的断言直接关单」——git log 是历史，
   issue 清单不是。四组各 0/10、合计 40/40 通过，没有可复现的失败态。结论是
   「最新主干本机未复现」，**不是**「已修」，也**不是**「该现象不存在」。
3. **顶楼要改的两处措辞**：① 「chromium 1/10、守卫吞键」标为不成立——当前守卫按 target id
   比对（`src/controls/dpad.ts`），`tests/dpad.test.ts` 有断言锁；② 历史 webkit 判词「按压落在
   被重建的 DOM 上」在当前代码里没有对应机制（dpad 只在 `src/index.ts:283` 创建一次），
   不要再当事实引用。
4. **不要把「有提示的丢弃」写成静默丢键**：非 synced 窗口的 input 不发送并发一次
   `Not sent — still syncing.`（`send()` / `showNotSentNotice()`）。改不改这个行为需要真实命中
   样本，不在本轮猜。弱网下不自动重放已发命令是当前文档契约。
5. **重开条件**（命中任意一条即重开，附新 SHA、`[dpad-diag]` dump 与该轮 n/N）：真实 CI 里
   再出现、真实触屏设备上再出现、或同 target 按键在连接迁移窗口内真的丢失。历史观察窗口：
   run `36256047180`。「点按在 attachment 换代时被吞」是**未实测候选**，不是已确认机制，
   不写进重开条件当既成事实。

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

- 最后确认于 `1e6619837fa42b1b76ce87049172201fab215ef1` / 2026-10-12 / 0/10（四组各 0/10：
  c-enter、w-enter、c-right、w-right；合计 40/40 通过仅为同轮汇总，不作单条 n/N）
- 环境：本机 20 vCPU，load ≈ 3.2；失败态 = 无失败；平台/浏览器缺失不适用（chromium 与 webkit 均实际执行）

### 可直接贴进 #147 顶楼的收口短文（供主脑使用，本卡未执行任何 gh 写操作）

> 分诊（2026-10-12，基线 `1e66198`）：按原入口在最新主干复跑四组目标用例
> （chromium-android / webkit-iphone × holding ⏎ / holding →，每组 `--repeat-each=10`、
> `--workers=1 --retries=0`），失败 n/N = 0/10 ×4，合计 40/40 通过，每 case retry=0；
> 原始 JSON 与 sha256 见本仓 `docs/sessions/herdweb-261012-triage/triage.md`。
> 历史失败的前驱条件（长按窗口内 socket 断开 / re-attach）本轮 0 次出现，故对 webkit 那条历史
> 签名既未证实也未证伪。按仓规「复现不出来的断言直接关单」建议关单；若真实 CI 或真实触屏再命中，
> 请带新 SHA、`[dpad-diag]` dump 与该轮 n/N 重开。

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

### 凭据前置（本轮新增发现，两个缺口都会让真实 run 显式失败）

```sh
gh repo view zlxlabs/herdweb --json visibility            # PUBLIC
gh secret list -R zlxlabs/herdweb                         # 空：没有任何 repo secret
gh secret list --org zlxlabs --json name,visibility        # SILO_ACCESS_KEY / SILO_SECRET_KEY → "private"
```

| 缺口 | 后果 | 依据 |
|---|---|---|
| org secret `SILO_*` visibility=`private`，本仓是 PUBLIC → 公开仓读不到 | `primary` job 的 `Upload canonical primary audit` 以 `if: always()` 运行，缺 key 时 `exit 1` → 以 `SILO_ACCESS_KEY 未传入` 显式失败 | `gate-v2.yml:1186-1199` |
| 本仓没有 `PWRS_REPORTER_TOKEN` | 走查直传 PWRS 的 reporter CLI 拿不到 token → 显式失败 | 平台模板 `templates/ui-visual/workflow.yml:181` |

两个缺口都是**凭据授权**问题（不是代码问题），执行器无权在本仓 workflow 里塞凭据、也不许改
callee / 换 runner 归属绕过；接入卡遇到即停下上报，并把 primary 的验收标为「未能判定」。
org 内目前没有任何公开仓在跑 gate-v2（`zlxlabs/gate`、`zlxlabs/ci-templates` 都没有 caller），
所以也没有反例能证明这条推断不成立。

### 结论与建议

- 状态维持 `status:ready` / `priority:P2`（权限前提已解除，卡可执行）。
- 关单谓词（①②同时成立）：① 三个 caller + `scripts/gate-quality` + 走查 workflow 在一个 PR 合入，
  且**合并前**的 ready PR 上 `gate / gate` 的 `primary` job 真实执行（job 级 conclusion 为
  SUCCESS，SKIPPED 不算）；② PR 上 `ui-evidence` 评论里的报告链接可打开、标题含完整 40 位 head SHA；
  随后删除 `AGENTS.md` 的 `ui-evidence-exempt`。凭据前置未解决时①记为「未能判定」并停下上报，
  不降级验收标准。
- 接入 ≠ 分支保护已改：本卡不新增 required check 配置（那是仓库设置的写操作），也不改 `ci.yml`
  的触发器——`check` 是 main 的 required check，它靠 workflow 总触发而非 `if:` 生效，这条不能碰；
  `gate-shadow` 不是 required，`paths-ignore` 跳过 docs 不会卡合并。
- 自托管 `ci` 池执行同仓 PR 代码是平台既有模型（registry 已 `runner: self`），接入卡沿用，
  **不**申请新权限、**不**改变风险边界；外部 fork 运行一律不批准 + 触发器白名单按现契约执行。

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
