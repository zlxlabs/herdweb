# 任务卡：注意力层 v1 · 卡 4 收尾（README 通知节 + skill onboarding + GOALS 里程碑）

## 目标

功能全部合入后补文档：README 通知使用说明（如实标注前提与延迟）、herdweb-setup skill 的推送 onboarding、GOALS.md 记录通知里程碑（含 goals/ 进度文件）、AGENTS.md 模块清单与 deploy 文档同步状态目录契约。

前置：卡 1/2/3 已合入 feat/notify-attention。HANDOFF：`docs/sessions/260822-2132-notify-attention/HANDOFF.md`。

## 非目标

- 不改任何 `src/**` 生产代码与测试；不加新功能；不改 CI/workflows。
- 不写 CHANGELOG（semantic-release 自动）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm run check
- **Diff-Lines-Target**：180
- **Diff-Lines-Hard**：420
- **阶段**：implementing
- **锁定决策**：
  1. README 通知节必须如实写明：①iOS 前提=添加到主屏幕的 PWA（iOS 16.4+，Safari 标签页无 Push API）；②VAPID 首次启动自动生成，轮换走 config `notify.vapid.*`；③状态目录按端口分仓 `~/.local/state/herdweb/{port}/`（7681/7691 并发互不干扰）；④`POST /api/events` 仅回环 + 可选 `notify.token`——外部事件源须与 herdweb 同机；⑤延迟如实：herdweb 自有静默车道 3-5 分钟；badge 车道（asking/done/ci-red）接入后典型 60-90 秒，且该车道在 agent-config 侧（zlxlabs/agent-config#495）未合入前不可用——不得写成「已可用」；⑥curl 冒烟示例一条。
  2. `.agents/skills/herdweb-setup/SKILL.md`：推送 onboarding 步骤（订阅路径 ☰→🔔→通知面板、iOS 主屏引导、测试按钮验证、故障排查一行：检查 vapid.json 与订阅文件）；config 变更表补 `notify.*` 全量键。skill 与真实 config 形状/CLI 行为同步是该文件自身纪律。
  3. `goals/M4-notify-attention.md` 进度文件（完成定义引用 HANDOFF 的用户可感知验收 + 真机人工门清单，状态标注「代码完成，真机人工门待用户执行」）；GOALS.md 索引行由主脑维护（闸规则），执行器不得改 GOALS.md。
  4. AGENTS.md Module Layout 加 `src/notify/` 与 `src/sw-entry.ts` 一行；`docs/deploy-herdr.md` 补状态目录契约与重启只发一条通知的运维预期。
- **任务类型**：tests-docs
- **复杂度**：M
- **Base commit**：a9ee03b（t1+t2+t3+fix1 已合入 feat/notify-attention）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收；审查按 review-discipline 纪律另行派卡

## 修改边界

- **允许**：`README.md`、`.agents/skills/herdweb-setup/SKILL.md`、`goals/M4-notify-attention.md`（新建）、`AGENTS.md`、`docs/deploy-herdr.md`
- **禁止**：`GOALS.md`（主脑维护，闸规则）、`src/**`、`tests/**`、`.github/workflows/**`、`CHANGELOG.md`、`docs/sessions/cards/**`（历史卡不再改写）
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：README.md .agents/skills/herdweb-setup/SKILL.md goals/M4-notify-attention.md AGENTS.md docs/deploy-herdr.md
- **高风险区域**：无（纯文档）；注意 README 中不得出现夸大可用性表述（badge 车道未接入）。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：新用户按 README 通知节可独立完成订阅与测试（步骤与卡 1 实现的真实 UI 文案/路径一致）；`grep -n 'notify' .agents/skills/herdweb-setup/SKILL.md` 有配置键说明。
- **相关测试**：`pnpm test`（确认无文档引起的环境类失败）+ `pnpm run check`。
- **概率性验收**：不适用。
- **接口契约**：不适用（无代码）。
- **lint / typecheck / build**：`pnpm run check`。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：按「README → skill → GOALS/goals 文件 → AGENTS+deploy」分 3-4 次 commit。
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

- **现场事实（主脑预取）**：GOALS.md 当前无激活里程碑（M1-M3 已收口）；README 无通知节；skill 无 notify 键说明；AGENTS.md Module Layout 无 src/notify 行。
- **机理/根因陈述**：无。
- **已完成**：设计定稿。
- **未完成**：全部文档。
- **关键决策**：badge 车道表述以 issue 状态为准（未合入=不可用）。
- **已否决方案**：手写 CHANGELOG（semantic-release 自动）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：真机人工门（Android Chrome + iOS 主屏 PWA）由用户执行，文档中列为验证清单。
- **下一步唯一动作**：按「完成条件」实现并在分支上提交。
