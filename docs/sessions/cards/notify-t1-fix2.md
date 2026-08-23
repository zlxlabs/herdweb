# 任务卡：注意力层 v1 · fix2 — awaitInFlight 的 10s 败者定时器持有事件循环（终验发现 P1）

## 目标

修复终验门禁发现的 P1 回归：`src/notify/service.ts` 的 `awaitInFlight` 用 `Promise.race([allSettled, sleep(timeoutMs)])`，race 被 allSettled 秒解后**败者 setTimeout(10s) 从未被 clear 也未 unref**——定时器作为活动句柄把事件循环占住整整 10 秒。后果：PTY 自然退出后 `notifyDrain` 返回、`server.close()` 完成，但 herdweb serve 进程**再挂 ~10 秒才退出**。`tests/playwright/session-exit.spec.ts` 的 `proc.exited` 5 秒轮询因此稳定失败（fix1 在 promise 链上多加一拍微任务后，health push 的 settlement 晚于 drain 快照，使该路径从偶发变稳定可触发）。

## 非目标

- 不改 awaitInFlight 的语义（快照式单次等待仍是卡面 P3-5 已记录的可接受行为）；不加循环重试。
- 不动 service.ts 其余逻辑、面板、SW、serve 序列。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：120
- **阶段**：repairing
- **root_cause_group**：Promise.race 败者资源未回收（定时器句柄泄漏）
- **introduced_by_commit**：5ba8dff（t1 的 awaitInFlight 原始实现）；96a860a/b27a8c5（fix1 链上多一拍微任务使雷稳定引爆）
- **open_findings**：
  - F-P1-2：awaitInFlight 败者定时器未 clear/unref → 自然退出路径进程残留 10s（主脑终验实证，见下）
- **锁定决策**：
  1. 修法（最小）：捕获定时器句柄，`try { await race } finally { clearTimeout(timer) }`，且创建时 `timer.unref()`（双保险：即使未来有人改动 clear 逻辑，unref 也保证它永不阻塞进程退出）。TypeScript strict，禁 any。
  2. 新增回归测试（放 tests/notify-push.test.ts 或新文件 tests/notify-service-drain.test.ts）：用 `process.getActiveResourcesInfo()`（Node 22+ 可用）断言——向 inFlight 注入一个可控 pending promise，调 `awaitInFlight(60_000)`，外部 resolve 该 promise 使 race 秒解，然后断言 `getActiveResourcesInfo()` 中 `Timeout` 数量回落到调用前水平（证明无残留定时器）；再断言超时路径仍生效（pending 永不 resolve 时 awaitInFlight 在 timeoutMs 内返回——用小 timeoutMs 如 50ms）。
  3. E2E 复验：`pnpm run test:pw -- tests/playwright/session-exit.spec.ts` 连跑 ≥5 次记录通过率（本机当前多会话高负载，允许 webkit 出现已知页面竞态偶发，但 `proc.exited` 超时模式必须 0 次）。
  4. 主脑实证（scratch 已验证修法有效）：同一 patch 下 session-exit spec 由稳定红转 4/6 绿（残余为另一模式：webkit 输出快照竞态，非本卡范围）；未打补丁的 a9ee03b 为 webkit 稳定红（proc.exited null）。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：047c522（feat/notify-attention 当前 tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收

## 修改边界

- **允许**：`src/notify/service.ts`（仅 awaitInFlight）、`tests/notify-push.test.ts` 或新建 `tests/notify-service-drain.test.ts`
- **禁止**：其余一切文件；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/service.ts tests/notify-push.test.ts tests/notify-service-drain.test.ts
- **高风险区域**：无（局部修复）

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：新增定时器零残留断言绿；超时路径断言绿。
- **相关测试**：`pnpm test`（全量）；`pnpm run test:pw -- tests/playwright/session-exit.spec.ts` ≥5 次（锁定决策 3 的记录要求）。
- **概率性验收**：session-exit spec ≥5 连跑中 `proc.exited` 超时模式 0 次（其余已知竞态模式记录条数即可，不判败）。
- **接口契约**：不变。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit` 绿。
- **截图或探活**：报告贴 5 连跑结果。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：修复+测试一次、5 连跑记录补一次（如报告即证可 1 次提交）。
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

- **现场事实（主脑预取）**：二分证据链——base（origin/main）session-exit 4 连跑全绿；a9ee03b（含 fix1）webkit 稳定红（proc.exited null）；285f356（fix1 前）绿；scratch 打 clear+unref 补丁后退出挂起消失。根因代码：`src/notify/service.ts` awaitInFlight（race 败者 setTimeout 未 clear/unref）。
- **机理/根因陈述**：`Promise.race 败者 setTimeout 未清理 → 事件循环被活动句柄占住至定时器到期`（证据锚点：src/notify/service.ts awaitInFlight + session-exit.spec.ts:107 proc.exited 轮询 5s 超时）。
- **已完成**：主脑 scratch 验证修法。
- **未完成**：正式修复+回归测试。
- **关键决策**：clearTimeout+unref 双保险；快照语义不改。
- **已否决方案**：循环等待至 inFlight 清空（P3-5 已判可接受，不扩大范围）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：webkit 输出快照竞态为另一独立偶发（非本卡）。
- **下一步唯一动作**：修 awaitInFlight + 测试 + 5 连跑。
