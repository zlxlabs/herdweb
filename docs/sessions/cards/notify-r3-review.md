# 任务卡：注意力层 v1 · R3 终轮审查（a9ee03b..743ed88 文档增量 + 收敛判定）

## 目标

对 R2 之后的增量 `a9ee03b..743ed88`（t4 文档四提交 + GOALS.md 索引行 + 卡/verdict 文件）做终轮独立审查，产出 verdict 与「新增 P1 数」显式数字，用于满足 infra 例外收敛（连续 2 轮无新增 P1；R2 已 0）。

## 非目标

- 不重开 R1/R2 已判事项（backlog P3 不修不报）；不改代码。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：test -f docs/sessions/260822-2132-notify-attention/reviews/notify-r3-verdict.md
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：150
- **阶段**：reviewing
- **锁定决策**：
  1. 先读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md` 与 R2 verdict `docs/sessions/260822-2132-notify-attention/reviews/notify-r2-verdict.md`。
  2. 本轮视角：**文档-实现一致性**——逐条核对 README/skill/goals/AGENTS/deploy 中的技术断言与代码事实（键名、默认值、端点路径、状态目录、延迟数字、iOS 前提、#495 状态），这是 R1/R2 都没覆盖的维度；并确认增量无任何生产代码/测试改动。
  3. 文档类红线：把未接入的 badge 车道写成可用=虚标（P1）；其余文档问题按 P3 记。
  4. 已知噪音勿报（serve-abuse 偶发等；同 R2 卡锁定决策 6）。
- **任务类型**：review
- **复杂度**：S
- **Base commit**：743ed88（终点）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建（检出 743ed88）
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与终审；本卡执行者即独立审查人

## 修改边界

- **允许**：`docs/sessions/260822-2132-notify-attention/reviews/notify-r3-verdict.md`（仅此一个新增文件）
- **禁止**：一切其他改动；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：docs/sessions/260822-2132-notify-attention/reviews/notify-r3-verdict.md
- **高风险区域**：无

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：verdict 含：①增量改动清单确认（应只有 docs/goals/AGENTS/卡/verdict，无 src/tests）；②文档技术断言逐条核对表（断言→代码事实→一致/不一致）；③最终 verdict pass/fail + 新增 P1 数。
- **相关测试**：只读验证自选（grep/读取源码对照）。
- **概率性验收**：不适用。
- **接口契约**：不适用。
- **lint / typecheck / build**：不适用。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：verdict 一次成型一次 commit。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md 正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取）**：a9ee03b..743ed88 = t4 四 docs 提交（eb0d09e/fd3f818/5ae1533/fee92e6）+ GOALS.md 索引行（2b6ca37）+ R2 verdict 合并（743ed88）；t4 树 910/910 绿。R1/R2 verdict 均已入库。
- **机理/根因陈述**：无。
- **已完成**：R1（fail→修）、R2（pass 0 新增 P1）。
- **未完成**：R3 终轮。
- **关键决策**：文档-实现一致性维度。
- **已否决方案**：无。
- **修改文件**：仅 verdict 文件。
- **测试及结果**：见现场事实。
- **已知问题**：无。
- **下一步唯一动作**：读 skill+R2 verdict → 核对文档断言 → verdict。
