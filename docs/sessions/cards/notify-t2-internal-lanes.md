# 任务卡：注意力层 v1 · 卡 2 内部车道（静默检测 + 健康单通知 + 停机排空）

## 目标

给推送管道接上 herdweb 自有的两条内部车道，并完成停机排空：①静默车道——agent 持续输出后停 ≥3 分钟推「可能完工/卡住」；②健康车道——PTY 任意退出推「会话结束」，服务异常重启一次事故只推一条；③停机顺序改为 PTY exit → 写 last-session.json → 等在途推送 → server.close()。卡 1（notify-t1）已提供 `NotifyService.dispatchEvent` 等接口，本卡是纯消费+新状态机。

前置：`docs/sessions/260822-2132-notify-attention/HANDOFF.md`；卡 1 的接口契约（`notify-t1-push-pipeline.md` 完成条件节）。

## 非目标

- 不改 /api/events、push、SW、面板（卡 1 已定型）；不做历史列表（卡 3）。
- 不解析 agent/herdr 输出内容——车道只看字节量与进程生命周期。
- 不消除「无法区分等用户与跑长任务」的坦白限制——标题措辞就是「可能完工/卡住」。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：900
- **阶段**：implementing
- **锁定决策**：
  1. 静默状态机参数（config 已由卡 1 接入 schema）：`notify.silence.{enabled=true, busyMs=30000, quietMs=180000, cooldownMs=600000}`。判定：`SharedTerminalSession` 增逐 chunk 字节累加器（每条 PTY data 记 `Buffer.byteLength(chunk)` 与 ts，滚动窗口只保留 ≥ now-busyMs 的记录）；30s 定时器检查：trailing busyMs(30s) 窗口字节和 ≥1024 = **busy**；进入过 busy 后连续 quietMs(180s) 零输出 = **触发**；触发后同 session 冷却 cooldownMs(10min)；冷却期内再次 busy → 重置冷却并重新武装（新 busy 周期后的新静默可再触发）；触发瞬间若同 sessionKey 在 cooldownMs 窗口内已有其他车道事件（`NotifyService.lastEventAt(sessionKey)`）→ 让位不推。
  2. 事件构造：kind=silence，`id=silence:{sessionKey}:{floor(ts/60000)}`（确定性 id 防时序 flap），title=`herdweb · {sessionKey} 可能完工/卡住`，body=`已 {quietMs/1000} 秒无输出`，session=sessionKey。
  3. 分层纪律：`src/session.ts` **不得 import `src/notify/*`**——session 只暴露活动记录（如 `bytesInWindow(windowMs): number` 或活动回调），静默检测器 `src/notify/silence.ts` 消费它，接线在 serve.ts。检测器用可注入时钟/定时器（测试用 fake timers）。
  4. 健康车道：`{stateDir}/last-session.json` 按 herdr 会话键控：`{ [sessionKey]: { sessionId, exitedAt, exitCode, signal } }`。`extractSessionKey(command)` 放 serve.ts：解析 post-`--` argv，首参 basename 为 `herdr` 时取 `--session <值>`（含 `--session=x` 形式），无该 flag 或非 herdr 命令或无 `--` → `default`（例：`herdr --session dev` → `dev`；`bash --norc` → `default`）。PTY 任意退出（含信号）→ 推 kind=health「会话结束」（reason 带退出码/信号，`id=health:{sessionKey}:{进程启动时间戳}`）；随后写 last-session.json。下次启动：读旧记录，若 sessionId 变化 且 上次 exitedAt 距今 >120_000ms → 补推「服务已重启」（kind=health）；120s 内重启（crash-loop）不补推——一次事故合计一条通知；文件缺失（首次运行）静默只建文件不推。
  5. 停机排空（替换 serve.ts 现状「PTY exit → server.close()」）：顺序 = PTY exit → health「会话结束」dispatch + last-session.json 写入 → `NotifyService.awaitInFlight(10_000)` → `server.close()`。卡 1 已留 notifyDrain 挂点，本卡把 health 两步插进去。
  6. 静默/健康都走 `NotifyService.dispatchEvent`（统一去重/落盘/异步推送），不走 HTTP。
- **任务类型**：backend-logic
- **复杂度**：M
- **Base commit**：6f2570d8182e98679ade653cd86205d102ed4c58（卡 1 已合入 feat/notify-attention）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收；审查按 review-discipline 纪律另行派卡

## 修改边界

- **允许**：`src/session.ts`（字节累加器+活动查询，禁止 import notify）、`src/serve.ts`（extractSessionKey、health 接线、notifyDrain 补全）、`src/notify/silence.ts`（新建）、`src/notify/health.ts`（新建）、`src/notify/state.ts`（last-session 读写 helper）、`src/notify/service.ts`（仅当 lastEventAt 需要补语义）、`tests/notify-silence.test.ts`、`tests/notify-health.test.ts`、`tests/session-activity.test.ts`（新建）、`tests/serve.test.ts`（排空/健康/extractSessionKey 用例）
- **禁止**：`src/notify/{events,push,routes}.ts`、`src/controls/notify-panel.ts`、`src/sw-entry.ts`、`src/client-entry.ts`、`src/config-schema.ts`、`src/config.ts`（卡 1 定型）；`src/notify/history.ts`（卡 3 专属）；`README.md`、`.agents/skills/herdweb-setup/SKILL.md`、`GOALS.md`（卡 4）；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/session.ts src/serve.ts src/notify/silence.ts src/notify/health.ts src/notify/state.ts src/notify/service.ts tests/notify-silence.test.ts tests/notify-health.test.ts tests/session-activity.test.ts tests/serve.test.ts
- **高风险区域**：serve.ts 停机序列（顺序错=丢通知或服务悬挂）；session.ts 累加器不得泄漏（滚动窗口裁剪）；30s 定时器生命周期须随 session dispose 清理

## 不变式轴表

轴 1：静默状态机 × 活动/时间（表驱动 + fake timers，覆盖全部格子）

| 前置 | trailing 30s 字节 | 后续 | 期望 | 检测点 |
|---|---|---|---|---|
| 从未 busy | <1 KiB | 持续无输出 | 永不触发 | tests/notify-silence.test.ts |
| busy 已达成 | ≥1 KiB | 180s 零输出 | 触发一次 silence | 同上 |
| 触发后冷却内 | — | 仍无输出（无新 busy） | 10min 内不再触发 | 同上 |
| 触发后冷却内 | 再次 ≥1 KiB（新 busy） | 再 180s 零输出 | 冷却被重置，再次触发 | 同上 |
| 触发瞬间 | — | 同 session 10min 内已有其他事件 | 让位不推 | 同上 |
| enabled=false | 任意 | 任意 | 完全不武装 | 同上 |

轴 2：健康 × 启动历史

| 场景 | 期望 | 检测点 |
|---|---|---|
| PTY 正常退出 | 一条「会话结束」+ last-session.json 更新 | tests/notify-health.test.ts |
| PTY 被信号杀 | 同上（reason 带信号） | 同上 |
| 退出后 >120s 重启且 sessionId 变化 | 补推一条「服务已重启」 | 同上 |
| 退出后 ≤120s 重启（crash-loop） | 不补推（一次事故一条） | 同上 |
| 首次运行（文件缺失） | 只建文件不推 | 同上 |
| sessionId 未变（同会话） | 不补推 | 同上 |

轴 3：停机 × 在途推送

| 场景 | 期望 | 检测点 |
|---|---|---|
| 推送在途时 PTY exit | 排空等待（≤10s）后再 server.close，推送完成 | tests/serve.test.ts |
| 推送悬挂 >10s | 10s 上限后照常退出 | 同上 |

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：`pnpm exec tsx cli.ts serve --port 7782 -- bash --norc` 起服务，bash 里 `yes | head -c 200000 > /dev/null` 制造 busy 后静置——fake-timer 单测已锁行为，真机 3 分钟节律属人工门，不要求执行器真等。
- **相关测试**：`pnpm test`（全量）+ `pnpm exec vitest run tests/notify-silence.test.ts tests/notify-health.test.ts tests/serve.test.ts`。
- **概率性验收**：`pnpm exec vitest run tests/notify-silence.test.ts tests/notify-health.test.ts tests/serve.test.ts` 连续跑 5 次全绿（时序状态机卡，单次绿不计数）；主脑抽跑同样 5 次。
- **接口契约**：消费卡 1 契约不改动（改=打穿）；本卡新增导出：

```typescript
// src/notify/silence.ts
export interface SilenceDetector { dispose(): void }
export function createSilenceDetector(deps: {
  sessionKey: string; busyBytes?: number; // 默认 1024
  config: { enabled: boolean; busyMs: number; quietMs: number; cooldownMs: number }
  bytesInWindow(windowMs: number): number
  dispatch(event: NotifyEvent): void
  lastEventAt(sessionKey: string): number | undefined
  now?(): number; setIntervalMs?: number
}): SilenceDetector
// src/notify/health.ts
export function extractSessionKey(command: readonly string[] | undefined): string // 也可放 serve.ts，导出供测试
export function shouldAnnounceRestart(prev: LastSessionEntry | undefined, currentSessionId: string, now: number): boolean // >120s 且 sessionId 变化
```

- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist` 全绿（`.omo/` 本机噪音豁免，原文贴报告）。
- **截图或探活**：报告贴 5 连跑结果原文。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：按「session 累加器 → silence 状态机+表驱动 → health+last-session → serve 接线+排空 → 5 连跑」至少分 5 次 commit。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md 正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取）**：卡 1 已建 `src/notify/{events,state,push,service,routes}.ts` 与 NotifyService 契约；`SharedTerminalSession.sessionId` 为 randomUUID（src/session.ts:65），PTY exit 现走 serve.ts:661 附近的退出序列；snapshot 帧逻辑与本卡无交集。sessionKey 取值域实测（生产+debug 实例）：`default`（herdweb.service 7681）、`herdweb-dev`（debug 7691 `--session herdr-dev` 场景见 docs/deploy-herdr.md）、逃生口 `bash --norc` → `default`——键控文件按任意字符串实现，勿写死枚举。
- **机理/根因陈述**：无（新功能卡）。
- **已完成**：设计定稿；config schema（卡 1）。
- **未完成**：全部实现。
- **关键决策**：静默 id 按分钟取整（flap 防抖）；健康「会话结束」与「服务已重启」分两条但 120s 窗保证一次事故一条。
- **已否决方案**：区分「等用户」与「跑长任务」（无证据源，措辞坦白为「可能完工/卡住」）；解析 herdr 输出（spike NO-GO）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：静默节律 3-5 分钟是下界设计（busyMs+quietMs），真机感知验证走人工门。
- **下一步唯一动作**：按「完成条件」实现并在分支上提交。
