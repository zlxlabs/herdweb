# notify-attention R2 全量审查 · verdict

## 审查元数据

| 项 | 值 |
|---|---|
| 审查范围（冻结 H0） | `fb1c6ec728e842e75f853e38e2eb078168ff8889..a9ee03b1c8f0e8c8e8f8e8f8e8f8e8f8e8f8e8f` → 实际终点 `a9ee03b`（feat/notify-attention 合并 fix1 后） |
| 增量审范围（H0..H1） | `39a9a79..28434a2`（fix1 四轮修复提交） |
| 审查人 | delegate 派发独立审查（Cursor，对抗视角） |
| 风险等级 | infra 例外 |
| Spec | `docs/sessions/260822-2132-notify-attention/HANDOFF.md` 不变式节 + `notify-t2-internal-lanes.md` / `notify-t3-history-inbox.md` / `notify-t1-fix1.md`（自 feat/notify-attention 读取） |
| OCR 前置 | status=`reviewed`，90 条；envelope `/tmp/opencode/ocr-r2.json`；本审查逐条独立核实，不照搬 OCR 理由 |
| 本轮新证据 | ① a9ee03b 临时 worktree 跑 notify 单测 76/76 + serve 28/28；② 静默/健康时序 5 连跑各 25/25；③ `shouldAnnounceRestart` 120s 边界探针（gap=120000→false，120001→true）；④ history limit 钳制探针（`0→1`、`501→500`、`abc→50`）；⑤ `rg` 确认 SW 无 `respondWith`/`fetch` handler；⑥ fix1 增量 diff 四问对抗审 |

## 一、H0..H1 增量审四问（39a9a79..28434a2）

| # | 问题 | 结论 | 证据 |
|---|---|---|---|
| Q1 | 本轮是否只修 R1 登记 findings？ | **通过** | 4 个 fix commit 仅触达 `service.ts`（F-P1-1/F-P2-6）、`state.ts`（F-P2-1/F-P2-7）、`notify-panel.ts`（F-P2-2/3）、`sw-entry.ts`（F-P2-4）、`serve.ts`（F-P2-5）及对应测试；无卡 2/3 源码越界 |
| Q2 | 是否新增未经批准抽象？ | **通过** | 仅 `SW_READY_TIMEOUT_MS` 常量（fix1 卡 F-P2-3 明示超时降级）与 `setImmediate` 延后 trim（F-P2-7 明示减法）；无新模块/接口/配置项 |
| Q3 | 状态/事实源/fallback 是否无依据增加？ | **通过** | `.catch(console.error('herdweb: notify push failed'))` 字面量符合 fix1 锁定决策 2；trim `catch` 仅吞「defer 间文件被删」；SW 超时降级文案为 fix 卡要求 fail-safe |
| Q4 | 是否留下双路径？ | **通过** | `writeJsonFileAtomic` 旧 chmod 重读写路径已删；trim 仅 `setImmediate` 单路径；push 错误仅 `.catch` sink 单路径 |

**增量审结论**：四问均通过，**不计入新增 P1**。

## 二、R1 八条 findings 逐条复验

| ID | R1 级别 | 复验结论 | 本轮证据 |
|---|---|---|---|
| F-P1-1 | P1 | **已消除** | `service.ts:169-172` `.catch` + 前缀；`pnpm exec vitest run tests/notify-push.test.ts -t unhandledRejection` 绿，stderr 打出 `herdweb: notify push failed` 无 `unhandledRejection` |
| F-P2-1 | P2 | **已消除** | `state.ts:46-49` rename 后无 read+rewrite；`tests/notify-state.test.ts` 原子写回归绿 |
| F-P2-2 | P2 | **已消除** | `notify-panel.ts:237-248` POST try/catch + unsubscribe；`tests/notify-panel.test.ts` POST reject 用例绿 |
| F-P2-3 | P2 | **已消除** | `notify-panel.ts:185-188` `Promise.race(ready, 5s)`；超时文案 `Service worker unavailable or timed out`；面板测试绿 |
| F-P2-4 | P2 | **已消除** | `sw-entry.ts:79-82` 非 ok → unsubscribe + throw；`tests/notify-push.test.ts` SW 重订阅失败用例绿 |
| F-P2-5 | P2 | **已消除** | `serve.ts:803` PTY exit 尾 `await session?.dispose()`；`tests/serve.test.ts`「disposes terminal session after PTY exit」绿 |
| F-P2-6 | P2 | **按 fix1 范围消除 prune 腿；subscribe↔push RMW 残余 ≤P2** | `service.ts:142` `inFlight.size>0` 跳过 prune；`tests/notify-push.test.ts`「skips stale prune while push delivery is in flight」绿。subscribe 路由与 push 成功写仍可能并发 RMW——fix1 卡明示「先试减法、不加锁」，属已知残余，**非本轮新增** |
| F-P2-7 | P2 | **按 fix1 范围改进；defer 窗口残余 ≤P2** | `state.ts:72` `setImmediate(() => trimEventsFile(...))`；`tests/notify-state.test.ts`「defers trim via setImmediate」绿。defer 后另一请求可在 read/write 间 O_APPEND——R1 已判 P2 低概率，**非本轮新增 P1** |

## 三、卡 2 全量审查（静默/健康/停机，对抗视角）

### 状态机轴表对抗

| 轴 | 对抗输入 | 结论 | 证据 |
|---|---|---|---|
| busy 边界 | trailing 30s 恰 ≥1024B | 符合 spec | `silence.ts:44` `>= busyBytes`；单测「busy then 180s quiet」 |
| quiet 边界 | 恰 180s 零输出 | 符合 spec | 单测 `advance(180_000)` 触发一次 |
| 冷却内无新 busy | 触发后再 600s | 不二次触发 | 单测「no re-trigger within cooldown」 |
| 冷却内新 busy | 再次 busy + 180s quiet | 冷却重置再触发 | 单测「cooldown reset on new busy」 |
| 让位窗口 | `lastEventAt` 在 cooldownMs 内 | 让位不推 | 单测「yields when other lane event」；`silence.ts:66-71` |
| enabled 切换 | `enabled=false` | 不武装 | 单测「enabled=false — never arms」 |
| 伪定时器 5 连跑 | vitest fake timers | 稳定 | 5× `Tests 25 passed (25)` |

### 健康/停机对抗

| 场景 | 结论 | 证据 |
|---|---|---|
| PTY exit → health dispatch + last-session | **符合** | `serve.ts:789-797` `handleSessionExit` 先 dispatch 再 `updateLastSessionEntry` |
| 停机顺序 drain | **符合** | `serve.ts:798-801` dispose silence → `notifyDrain` → dispose service → `server.close()`；对齐 HANDOFF「PTY exit → last-session → await 在途推送 → close」 |
| 120s crash-loop 边界 | **符合** | 探针：`gap=120000→false`，`gap=120001→true`；单测「within 120s」/「gap >120s」 |
| session.ts 不 import notify | **符合** | `session.ts` 仅暴露 `bytesInWindow`/`lastOutputAt` |
| 状态目录按端口分仓 | **符合** | `resolveNotifyStateDir(port)` → `~/.local/state/herdweb/{port}/` |

### 卡 2 findings

| ID | 级别 | 摘要 | 违反条款 | 证据 |
|---|---|---|---|---|
| （无新增 P1） | — | — | — | — |
| F-R2-P2-1 | P2 backlog | SIGINT/SIGTERM `cleanup()` 不 dispatch health、不写 last-session（与 PTY 自然退出路径不对称） | HANDOFF「PTY 任意退出都推 health」字面仅覆盖 PTY exit；用户 Ctrl+C 杀 serve 时监控面消失无通知 | `serve.ts:768-778` cleanup 无 `handleSessionExit`；属运维边界，personal ≤P2 |
| F-R2-P3-1 | P3 backlog | 静默定时器 `dispatch` 无错误边界，`appendEventLine` 同步抛错可冒泡到 timer | 卡 2 未要求；磁盘满场景极低概率 | `silence.ts:84` → `dispatchEvent` 无 try/catch |

## 四、卡 3 全量审查（history 端点 + 面板，对抗视角）

| 对抗输入 | 结论 | 证据 |
|---|---|---|
| `limit=0/-1/501/abc` | 钳制 1..500 或默认 50 | 探针：`0→1`，`501→500`，`abc→50`；`tests/notify-history.test.ts` 13 项绿 |
| 损坏 jsonl 行 | 跳过 corrupt | `history.ts:60-62` |
| kind=test | 不出现 | `isStoredEvent` 排除 `test` |
| fetch reject / 非 2xx | 面板 fail-safe | `notify-panel.ts:157-178` try/catch + 错误行 |
| 端点鉴权 | origin 中间件、非回环（锁定决策） | `routes.ts:130-131` `requireOrigin`；与卡 3 锁定决策 1 一致 |

### 卡 3 findings

| ID | 级别 | 摘要 | 违反条款 | 证据 |
|---|---|---|---|---|
| （无新增 P1） | — | — | — | — |
| F-R2-P3-2 | P3 backlog | history 与 push 共用 `pushLimiter`，高频事件时 history GET 可 429 | 卡 3 未禁止；personal 可接受 | `routes.ts:132-133` |

## 五、熵增审查

| 新增项（fb1c6ec..a9ee03b） | 第二消费者 | 结论 |
|---|---|---|
| `src/notify/silence.ts` | serve.ts 接线 | 必要（卡 2 契约） |
| `src/notify/health.ts` | serve.ts + 测试 | 必要 |
| `src/notify/history.ts` | routes.ts + 面板 | 必要（卡 3 并行切分） |
| `session.ts` 活动累加器 | silence 检测器 | 必要（卡 2 分层纪律） |
| fix1 仅 `SW_READY_TIMEOUT_MS` | 无 | 实现细节，非抽象 |

**熵增结论**：无未经批准的熵 +1；OCR 提出的 `bundleBrowserIIFE` 合并等 maintainability 意见 ≤P3，不重复报 R1 backlog。

## 六、OCR 核实摘要

- status=`reviewed`，90 条；verify partial（79 unverified）——本审查不采信未核实 OCR 标签。
- 独立核实样本：SW 无 fetch handler（**refuted** OCR 若声称 otherwise）；history limit 钳制（**confirmed**）；build.ts 重复 bundle  helper（**confirmed ≤P3**，第二消费者未出现，不报）。

## 七、只读验证命令与结果

```text
# a9ee03b 临时 worktree
$ pnpm exec vitest run tests/notify-push.test.ts tests/notify-panel.test.ts \
    tests/notify-state.test.ts tests/notify-silence.test.ts tests/notify-health.test.ts \
    tests/notify-history.test.ts tests/notify-panel-history.test.ts
Test Files  7 passed (7)
Tests  76 passed (76)

$ pnpm exec vitest run tests/serve.test.ts
Test Files  1 passed (1)
Tests  28 passed (28)

$ for i in 1..5; vitest run tests/notify-silence.test.ts tests/notify-health.test.ts
run1..5: Tests 25 passed (25) each

$ pnpm exec vitest run tests/notify-push.test.ts -t unhandledRejection
✓ dispatchEvent does not emit unhandledRejection when push write fails

$ rg "respondWith|addEventListener\('fetch'" src/ tmp — 无匹配（SW 无 fetch handler）

$ tsx -e "shouldAnnounceRestart boundary"
gap=120000: false
gap=120001: true

$ tsx -e "parseHistoryLimitParam probe"
"0" -> 1, "501" -> 500, "abc" -> 50
```

## 八、最终 verdict

**pass** — R1 P1（F-P1-1）已消除；本轮 **新增 P1 数 = 0**。

infra 收敛：R1 有 P1 已修；本轮无新增 P1；尚需下一轮独立审查 0 新增 P1 方可满足「连续 2 轮无新增 P1」。
