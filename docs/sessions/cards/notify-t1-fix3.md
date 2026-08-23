# 任务卡：注意力层 v1 · fix3 — 清理 notify 新代码的 21 处 type assertion（CI lint:ox 红）

## 目标

`pnpm run lint:ox`（oxlint --import-plugin --promise-plugin）在 feat 分支红：21 处 `typescript-eslint(consistent-type-assertions)` 违规，全部在注意力层新代码。改为类型守卫/注解/`satisfies`，`lint:ox` 退出码归 0。base（origin/main）为 0 违规，不能带红合并。

## 非目标

- 不改任何运行时行为、公共签名、测试断言（除非编译需要联动——不允许改语义）。
- 不动既有非 notify 文件（mic-controller 等的输出是建议级，不在本卡）。
- 禁止用 `// oxlint-disable` 压制（结构性例外六项不豁免 lint 清理；真不可消除的个别处才允许 biome-ignore 同款注释并在报告说明理由）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm run lint:ox
- **Diff-Lines-Target**：80
- **Diff-Lines-Hard**：200
- **阶段**：repairing
- **root_cause_group**：新代码用 `as` 断言窄化 unknown/事件对象，绕过 strict 检查
- **introduced_by_commit**：89869c4/5ba8dff/9730a36/bce447f/0607d29/715de92（t1/t3 各实现提交）
- **open_findings**（主脑预取的完整清单，修复不得超出；以 `pnpm run lint:ox` 实际输出为准复核）：
  - src/notify/events.ts:37、:58
  - src/notify/history.ts:23、:28
  - src/notify/state.ts:37
  - src/notify/routes.ts:57、:163、:194
  - src/notify/service.ts:103、:104、:121
  - src/controls/notify-panel.ts:124、:166、:227、:235
  - src/sw-entry.ts:51、:57、:116、:121、:129、:136
- **锁定决策**：
  1. 修法优先级：unknown 窄化用类型守卫函数（`typeof x === 'object' && x !== null && 'k' in x` 模式）；对象形状用接口注解；字面量满足用 `satisfies`。SW 事件（PushEvent/NotificationEvent/ExtendableEvent）无 lib DOM 类型处，用局部 interface 声明结构（`interface PushEventCompat extends ExtendableEvent { readonly data: { text(): string | undefined } ; waitUntil(p: Promise<void>): void }` 风格）替代 `as`。
  2. 行为不变：改完 `pnpm test`（全量 912）必须全绿——本卡是纯类型层清理。
  3. 服务端 400/413 状态码窄化（routes.ts deny 的 `status as 400` 类）：改为 `c.text(message, status as StatusCode)`→用 hono 的 `StatusCode` 类型参数或直接让 deny 接受 `ContentfulStatusCode`。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：b0cb277（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收

## 修改边界

- **允许**：`src/notify/events.ts`、`src/notify/history.ts`、`src/notify/state.ts`、`src/notify/routes.ts`、`src/notify/service.ts`、`src/controls/notify-panel.ts`、`src/sw-entry.ts`（仅类型层改动）
- **禁止**：其余一切文件；`.github/workflows/**`；任何运行时语义变化
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/events.ts src/notify/history.ts src/notify/state.ts src/notify/routes.ts src/notify/service.ts src/controls/notify-panel.ts src/sw-entry.ts
- **高风险区域**：SW 事件的类型重写不得改变 handler 注册行为

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：`pnpm run lint:ox` 退出码 0（输出贴报告）。
- **相关测试**：`pnpm test`（全量）绿——证明零行为变化。
- **概率性验收**：不适用。
- **接口契约**：公共签名不变。
- **lint / typecheck / build**：`pnpm exec tsc --noEmit`、`pnpm run check`、`pnpm run build:dist` 绿。
- **截图或探活**：lint:ox 输出原文。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：服务端文件一次、客户端/SW 文件一次，共 ≥2 commits。
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

- **现场事实（主脑预取）**：feat b0cb277 上 `pnpm run lint:ox` 21 处 consistent-type-assertions（清单见 open_findings）；origin/main 0 处。CI run 32587395091 的 check job 因 lint:ox 红（test:pw 的 webkit 弱网偶发在重跑中已绿）。
- **机理/根因陈述**：`as 断言绕过 strict 检查被 oxlint 门禁拦截`（证据锚点：/tmp/opencode/ox.log 清单 + package.json:49 lint:ox 脚本）。
- **已完成**：违规清单预取。
- **未完成**：清理。
- **关键决策**：守卫/注解/satisfies 优先；禁 disable 注释。
- **已否决方案**：oxlint-disable 压制。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：按清单逐处改类型层并验证。
