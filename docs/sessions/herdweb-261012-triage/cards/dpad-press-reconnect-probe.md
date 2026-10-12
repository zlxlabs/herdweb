# 任务卡：#147 最小诊断——确定性造出「按压窗口跨越重连」并锁死当前行为

> 草案，供 Pi 主脑审定后派出。Task-Id 留空，由派发分配。
> **不给根治卡的理由**：最新主干 40/40 全绿，且 40 个 case 里「长按期间 socket 断开 /
> 二次 attach」这个前驱条件一次都没出现（0 次 close、0 次二次 attach）。没有因果证据就不写根因，
> 更不改行为。

## 目标

用仓库**已有**的 WebSocket 探针夹具，在真实 chromium-android + webkit-iphone 上确定性造出
「长按 ⏎ 的窗口内 socket 关闭 → 重连」，把三类失败（按压没落按钮 / 落按钮但被 `send()` 守卫丢 /
 发了但 PTY 没回显）区分开，并把它锁成常驻断言。产出的是**事实**，不是修法。
- **Evidence-Commands**：
  ```sh
  env -u CI TMPDIR=/tmp ./node_modules/.bin/playwright test \
    tests/playwright/dpad-press-reconnect.spec.ts --project=chromium-android \
    --workers=1 --retries=0 --reporter=json
  ```

## 非目标

- 不修 `send()` 的丢弃窗口、不做缓冲重放、不改 `pressStillCurrent`（PR #202 已修，重复修是回归）。
- 不改 `attach-committed` 对 `lastFailureReason` 的置空语义（那会翻 `tests/client-connection.test.ts`
  的既有断言，属独立语义变更，须单独立卡）。
- 不调大 timeout/retries、不 skip、不 `continue-on-error`。
- 不把「本机没复现」写成「已修复」。

## 基线与所有权

- **Task-Id**：（派发分配）
- **Fixes-Issue**：Refs #147（提交信息禁止写 `Fixes #147`）
- **Verify-Mode**：command
- **Verify-Command**：`git diff --check`
- **Narrow-Verify**：`env -u CI TMPDIR=/tmp ./node_modules/.bin/playwright test tests/playwright/dpad.spec.ts tests/playwright/dpad-press-reconnect.spec.ts --project=chromium-android --workers=1 --retries=0`
- **Diff-Lines-Target**：250
- **Diff-Lines-Hard**：450
- **阶段**：planning
- **锁定决策**：禁止自动重试/重放/缓冲；禁止防御式 catch；证据不足就交「未复现 + 观察窗口」，
  不硬凑根因。
- **任务类型**：debug
- **复杂度**：S
- **Base commit**：`1e6619837fa42b1b76ce87049172201fab215ef1`
- **Depends-On**：无（不碰 `.github/workflows/`，与 #178 接入卡可并行）
- **Branch**：`chore/261012-dpad-press-reconnect-probe`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：由 delegate 派发决定
- **子代理 fan-out**：0
- **提交授权**：授权 commit+push
- **计划者与审查者**：Pi lead

## 修改边界

- **允许**：新增 `tests/playwright/dpad-press-reconnect.spec.ts`；
  必要时**只读**复用 `tests/playwright/weak-network.spec.ts` 里已有的 WebSocket 探针
  （若需抽成共享 helper，只能抽到 `tests/playwright/` 内、命名体现 socket/press 语义，
  且必须有第二个消费者才抽——否则在 spec 内局部复制 10 行）；
  `docs/sessions/herdweb-261012-triage/progress/dpad-probe-progress.md`。
- **禁止**：`src/**`（**本卡不改任何生产代码**）、`playwright.config.ts` 的 timeout/retries、
  `tests/playwright/dpad.spec.ts` 的既有断言、其它仓文件。
- **Scope-Globs**：`tests/playwright/dpad-press-reconnect.spec.ts` `tests/playwright/weak-network.spec.ts`
  `docs/sessions/herdweb-261012-triage/progress/dpad-probe-progress.md`
- **高风险区域**：不得靠改源码补仪表；注入的监听必须只读。

## 实现要点

1. 新 spec 复用 `startIsolatedServe` 夹具（`tests/playwright/fixtures.ts` 的 `test` 已自带），
   沿用 `dpad.spec.ts` 的 `startByteEcho`（PTY 侧 `stty -echo -icrnl` + 每字节 hex 行），
   确保「屏幕上有没有字节」是终端探针的真实输出，不是测试内计数。
2. 在 `page.mouse.down()` 之后、`mouse.up()` 之前，用 `page.routeWebSocket` / 已有探针能力
   **强制关闭**当前 socket（先核对 `weak-network.spec.ts` 里既有做法，禁止另造一套机制），
   保持按住不放直到重连完成（用 `expect.poll(getConnectionStatus().state === 'synced')` 等待，
   不写死 sleep）。
3. 同时安装只读监听：沿用 `tests/playwright/dpad-diagnostics.ts` 的六段采集
   （`installDpadDiagnostics(page, testInfo)`），额外需要时**只**补记「按压开始/结束时刻」与
   socket lifecycle 的对齐点，不新增产品状态。
4. 判定必须三分：
   - 按钮事件计数全 0 → 假说 A：按压没落按钮（附 `document.elementFromPoint` 的读数）；
   - 计数非 0 且帧里无 `input` 帧 + notice `Not sent — still syncing.` → 假说 B：`send()` 守卫丢弃；
   - 帧里有 `input` 但屏上无 hex 行 → 假说 C：PTY 没回显。
   把命中的那一个写进断言与报告，不许三条同时含糊通过。
5. `DPAD_DIAG_FORCE` 语义保持不变（失败即 dump）；新 spec 不依赖该环境变量。

## TDD 红绿判据

1. 红：先写断言「强制断线后长按 ⏎ 必须在屏上产生 `0a`」，当前行为是丢弃 → 红。
2. 绿：把断言改成「锁死当前真实行为」（按键要么送达并被 PTY 打出 `0a`，要么被丢弃且**恰好一条**
   `Not sent — still syncing.` notice，且帧时间线里没有对应 `input` 帧）→ 绿。
3. 判据自检：把「注入的强制断线」去掉，用例必须回到「无断线 ⇒ 必然有 `0a`」并仍绿；
   再把断线注入改成断在 `mouse.down` **之前**，断言必须转红——两次喂已知答案，确认判据不是恒真。
4. 两个引擎各跑 `--repeat-each=5 --workers=1 --retries=0`，`retries` 全 0；任一引擎出现
   `flaky` 即判本卡红（不靠 retry 掩盖）。
5. `tests/dpad.test.ts` 全绿（确认没碰 press 守卫）。

## 真实输入 / 发送边界

- 输入边界：真实浏览器按下的方向键/⏎（`page.mouse` 真按压），不是 `page.evaluate` 调内部函数。
- 发送边界：真实 WebSocket `input` 帧的 hex（`0a` / `1b5b42` / `1b5b43`），在 Playwright 的
  `websocket.framesent` 上断言 payload 字节，不以「调用次数」替代发送结果。
- 消费边界：PTY 里 bash 探针打印的 hex 行。两侧都要断言，缺一侧等于没测。

## 失败可见性

- 每轮 `--reporter=json`，逐 case 记录 `status` 与 `retry`；结果文件随进度存档落仓内摘要
  （含 n/N 与 sha256），原始 JSON 留在执行器 `/tmp` 并写明取回方式。
- 复现不出来时，输出「未复现」并给出观察窗口建议（见收尾），**不算本卡失败**，但也不算 #147 已修。
- 环境缺失（浏览器未装、`TMPDIR` 过长导致 `tsx` 监听 EINVAL、herdr/ttyd 缺失）必须记录
  `command`、`exit_code`、stderr 白名单原文，并标 `blocked`，不得把环境失败算成复现阴性。

## 减法优先

- 不新增任何 `src/` 符号、状态、包装；本卡对产品代码的期望 diff = 0 行。
- 不把诊断逻辑塞进 `dpad-diagnostics.ts`（那是共享类，会影响 dpad.spec 的输出）；新 spec 自带只读采集。
- 不新增 vitest 单测来「覆盖」这个 e2e 现象；只有当发现**可确定复现的产品缺陷**时，才由下一张卡补单测。

## 收尾（交付给主脑的三选一）

拿到因果后按证据二选一（由主脑拍板，执行器不自行决定）：
- **A（假说 B 成立且产品选择「丢弃 + 提示」）**：本卡即为终点，更新 #147 顶楼 Repro 块，
  建议把 issue 收窄成「已知限制」或关闭，并在 `docs/architecture/mobile-viewport.md`
  记录断线期按键语义。
- **B（假说 B 成立且产品选择别的语义）**：另开一张产品卡（明确排队/逐次提示的语义与
  「断线期间不保证送达」的物理约束），本卡只交付证据。
- 若两个引擎都造不出「重连发生在按压窗口内」：记录未复现 + 观察窗口（建议盯 CI 上
  `dpad.spec.ts` 的 flaky 报告，run `36256047180` 为历史样本），并在 #147 顶楼把旧的
  「chromium 1/10」断言标为已由 PR #202 闭合。
