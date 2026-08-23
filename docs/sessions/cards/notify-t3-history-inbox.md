# 任务卡：注意力层 v1 · 卡 3 历史收件箱（history 端点 + 面板列表）

## 目标

错过的通知可回看：①`GET {basePath}/api/events/history?limit=` 返回 events.jsonl 尾部事件（新到旧）；②卡 1 的「通知」面板内加历史列表区（打开面板自动拉取 + 手动刷新）。前置：卡 1（notify-t1）已落盘 events.jsonl 与面板骨架。

## 非目标

- 不改 /api/events、push、SW、CSP、config schema（卡 1 定型）；不做静默/健康（卡 2）。
- 不做通知深链、多设备、按 kind 过滤、已读状态——v1 只读列表。
- 不新增 playwright spec（避免与卡 2 并行撞文件；历史列表用 happy-dom 单测锁行为）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：280
- **Diff-Lines-Hard**：600
- **阶段**：implementing
- **锁定决策**：
  1. `GET {basePath}/api/events/history?limit=N`：手机可达（origin 中间件，无回环/token——与卡 1 锁定决策 4 一致）；limit 缺省 50、钳制 1..500；响应 `{ events: NotifyEvent[] }` 新到旧；直接读 events.jsonl 尾部（kind=test 从不落盘，天然不出现）。
  2. 历史读取逻辑放 `src/notify/history.ts`（新文件），**不改 `src/notify/state.ts`**（该文件本批属卡 2——并行卡 Scope-Globs 不得相交）。
  3. 路由注册只改 `src/notify/routes.ts`（卡 1 已把 notify 端点集中在此，serve.ts 不动）。
  4. 面板列表区：打开面板时 fetch 一次 + 「刷新」按钮；每行 = kind 徽标（中文标签：asking 等待输入 / done 已完成 / ci-red CI 变红 / silence 可能完工 / health 服务状态）+ title + body?（可折叠为次要行）+ 相对时间（如「3 分钟前」，绝对时间 title 提示）；空态文案「暂无事件」；fetch 失败显示错误行并保留面板其余功能（fail-safe，对齐 help overlay 纪律）。
  5. DOM 创建一律走 `src/util/dom.ts` helpers，样式进 `styles/base.css`，风格对齐既有面板。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：6f2570d8182e98679ade653cd86205d102ed4c58（卡 1 已合入 feat/notify-attention）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收；审查按 review-discipline 纪律另行派卡

## 修改边界

- **允许**：`src/notify/history.ts`（新建）、`src/notify/routes.ts`（加 history 路由）、`src/controls/notify-panel.ts`（加列表区）、`styles/base.css`（列表样式）、`tests/notify-history.test.ts`、`tests/notify-panel-history.test.ts`（新建）
- **禁止**：`src/serve.ts`、`src/notify/state.ts`、`src/session.ts`（卡 2 并行占用）；`src/notify/{events,push,service}.ts`、`src/sw-entry.ts`、`src/client-entry.ts`、config 系文件（卡 1 定型）；`tests/serve.test.ts`、`tests/playwright/**`（避免并行冲突）；`README.md`、`.agents/skills/herdweb-setup/SKILL.md`、`GOALS.md`（卡 4）；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/history.ts src/notify/routes.ts src/controls/notify-panel.ts styles/base.css tests/notify-history.test.ts tests/notify-panel-history.test.ts
- **高风险区域**：`src/notify/routes.ts` 与卡 2 并行期无交集（卡 2 不碰此文件）——若发现仍需改禁区内文件，停下走 blocked 上行，不得越界。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：卡 1 的冒烟服务上先 POST 数条事件，`curl '127.0.0.1:{port}/api/events/history?limit=3'` 返回新到旧 3 条；面板打开即见列表，刷新按钮生效。
- **相关测试**：`pnpm test`（全量）；新增用例覆盖：limit 缺省/钳制/越界、新到旧排序、空文件与缺失文件返回空数组、test 事件不出现（本就不落盘）、面板渲染/空态/fetch 失败态、刷新按钮重新拉取（mock fetch，happy-dom）。
- **概率性验收**：不适用（无时序逻辑）。
- **接口契约**：消费卡 1 的 `NotifyEvent` 类型不变；本卡新增：

```typescript
// src/notify/history.ts
export function readEventHistory(stateDir: string, limit: number): NotifyEvent[] // 新到旧，读取尾部，钳制 1..500
```

- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist` 全绿（`.omo/` 噪音豁免）。
- **截图或探活**：报告贴 history curl 输出。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：按「history 读取 → 端点+测试 → 面板列表+测试」至少分 3 次 commit。
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

- **现场事实（主脑预取）**：卡 1 已建 events.jsonl 落盘（O_APPEND+惰性截断，kind=test 不落盘）与 notify 面板骨架（src/controls/notify-panel.ts）。「当前状态」其余各节由执行器完成后在报告中回填。
- **机理/根因陈述**：无（新功能卡）。
- **已完成**：设计定稿；落盘格式（卡 1）。
- **未完成**：全部实现。
- **关键决策**：history 读取独立成 history.ts 而非并入 state.ts——并行卡文件所有权切分。
- **已否决方案**：已读状态/过滤/深链（v1 non-goal）；新增 e2e spec（与卡 2 撞 tests/ 目录所有权）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：按「完成条件」实现并在分支上提交。
