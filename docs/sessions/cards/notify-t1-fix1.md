# 任务卡：注意力层 v1 · 卡 1 修复轮 1（清 R1 的 P1 + P2 清单）

## 目标

按独立审查 R1 verdict（`docs/sessions/260822-2132-notify-attention/reviews/notify-t1-verdict.md`）修复登记在案的 1 条 P1 与 7 条 P2，全部走减法路线（不加新抽象/状态/配置项），使下一轮审查（R2）无新增 P1。

## 非目标

- 不动 P3/backlog 清单（verdict 已判可接受不修）。
- 不改卡 1 接口契约签名（卡 2/3 已消费）；不重新设计；不加 fallback 层。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：400
- **阶段**：repairing
- **root_cause_group**：fire-and-forget 异步无错误沉没 + 「先行动后校验」的清理不对称（R1 findings 公共根因）
- **introduced_by_commit**：5ba8dff（F-P1-1）、89869c4（F-P2-1/F-P2-7）、bce447f（F-P2-2/F-P2-3）、0607d29（F-P2-4）、9730a36（F-P2-5/F-P2-6）
- **open_findings**（修复不得超出；每条以 verdict 文件为准）：
  - F-P1-1：`src/notify/service.ts` dispatchEvent 的 pushToAll promise 无 catch——ensureVapid/writeSubscriptions 抛错成未处理 rejection，Node 22+ 可终止 serve 进程。修复：给 fire-and-forget promise 接错误沉没（console.error 级 fail-loud 日志），保持 awaitInFlight 语义。
  - F-P2-1：`src/notify/state.ts` writeJsonFileAtomic 的 rename 后重读+重写 chmod 段——冗余且 TOCTOU。修复：删除该段（tmp 建立时已带 mode，rename 保留），如需显式收紧用 chmodSync。
  - F-P2-2：`src/controls/notify-panel.ts` subscribe 的 POST 抛错无回滚——孤儿浏览器订阅。修复：try/catch，失败时 subscription.unsubscribe() + 复位 UI。
  - F-P2-3：面板 getRegistration 无限 await serviceWorker.ready——SW 安装失败面板永久挂起。修复：超时降级（Promise.race + 状态文案），不得阻塞面板其余功能。
  - F-P2-4：`src/sw-entry.ts` pushsubscriptionchange 的 POST subscribe 无 ok 检查/无回滚。修复：非 ok 时新订阅 unsubscribe() 并 throw（让 waitUntil 记录失败）；DELETE 旧订阅保持 .catch 吞错但 POST 必须可见失败。
  - F-P2-5：`src/serve.ts` PTY exit 路径缺 `await session?.dispose()`（与 SIGINT cleanup 不对称）。修复：对齐 cleanup 序列（drain → dispose → close → caffeinate kill → session dispose），注意与卡 2 新增的 last-session/health 步骤合并后仍保持顺序：PTY exit → health+last-session → drain → close。
  - F-P2-6：writeSubscriptions 三处 read-modify-write 无序列化（push 成功写 / 24h prune / subscribe 路由）。修复（减法优先）：prune 在 inFlight.size>0 时跳过本轮；不加锁不加队列（除非减法证明不够，那也要在报告说明）。
  - F-P2-7：trimEventsFile 全文件重写与 O_APPEND 并发可丢事件。修复（减法）：把 trim 从 appendEventLine 内联调用改为 setImmediate 延后（单线程内在 append 之后原子执行，避免读-改-写窗口跨请求），或等效证明单线程同步已无窗口并写明理由。
- **锁定决策**：
  1. 修复优先做减法；禁止为修 P2 新增状态/机制/配置项（结构性例外六项核验不豁免 P2）。
  2. F-P1-1 的错误沉没用 console.error 前缀 `herdweb: notify push failed`（完整字面量，grep 友好）。
  3. 修复后须补/改测试锁死：F-P1-1（dispatchEvent 在 sendPush 抛错时不产生 unhandledRejection 且进程不退——可用 process 'unhandledRejection' 监听断言）、F-P2-2（POST reject → unsubscribe 被调）、F-P2-3（ready 永不 resolve → 面板超时降级）、F-P2-4（POST 500 → 新订阅 unsubscribe + waitUntil reject）。F-P2-1/5/6/7 至少各一条回归断言（行为级）。
- **任务类型**：backend-logic
- **复杂度**：M
- **Base commit**：285f356092bd5af13f1f80deef85b8dbc4ee5a68（t1+t2+t3 已合入 feat/notify-attention）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收；R2 增量审另行派卡

## 修改边界

- **允许**：`src/notify/service.ts`、`src/notify/state.ts`、`src/controls/notify-panel.ts`、`src/sw-entry.ts`、`src/serve.ts`、`tests/notify-push.test.ts`、`tests/notify-panel.test.ts`、`tests/notify-state.test.ts`、`tests/serve.test.ts`
- **禁止**：`src/notify/{events,routes,rate-limit}.ts`、`src/session.ts`、`src/notify/{silence,health,history}.ts`（卡 2/3 产物，如确需联动改動在报告写明并停下走 blocked 上行）、`.github/workflows/**`、README/GOALS/skill（卡 4）
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/service.ts src/notify/state.ts src/controls/notify-panel.ts src/sw-entry.ts src/serve.ts tests/notify-push.test.ts tests/notify-panel.test.ts tests/notify-state.test.ts tests/serve.test.ts
- **高风险区域**：serve.ts 停机序列已含卡 2 步骤——改动前先读当前实现，顺序不变式：PTY exit → health/last-session → drain → server.close

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：逐条对照 open_findings，verdict 的复现路径全部转绿（F-P1-1 的 unhandledRejection 演示不再触发）。
- **相关测试**：`pnpm test`（全量）；锁定决策 3 列出的新增断言全跑。验证命令写全量路径。
- **概率性验收**：不适用（无时序重试逻辑新增）。
- **接口契约**：不改卡 1 契约签名。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist` 全绿（`.omo/` 噪音豁免）。
- **截图或探活**：报告贴 F-P1-1 修复前后的探针输出（unhandledRejection true → false）。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：按「P1 → P2 服务端 → P2 客户端/SW → serve 序列 → 测试补齐」至少分 4 次 commit。
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

- **现场事实（主脑预取）**：verdict 文件在 feat/notify-attention（1206864 合入）；R1 复现脚本思路见 verdict「测试与只读验证」节（unhandledRejection 探针）。卡 2/3 已合入本卡 base（派发时确认）。
- **机理/根因陈述**：`fire-and-forget promise 无 catch → unhandledRejection`（证据锚点：`src/notify/service.ts:168` + verdict 实证输出）。
- **已完成**：R1 审查（fail 定局）。
- **未完成**：全部修复。
- **关键决策**：全部减法路线；F-P2-6 先试「prune 跳过」减法。
- **已否决方案**：为 P2 加互斥锁/写队列（结构性例外六项不豁免 P2）；扩配置项。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：serve.ts 停机序列与卡 2 产物有交叠，改动须基于合并后代码。
- **下一步唯一动作**：按 open_findings 逐条修复并提交。
