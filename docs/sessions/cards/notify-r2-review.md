# 任务卡：注意力层 v1 · R2 全量审查（fb1c6ec..a9ee03b，含 H0..H1 增量审）

## 目标

对 feat/notify-attention 全量 diff 做独立审查并产出 verdict。两段：①对修复增量 `39a9a79..28434a2` 做 H0..H1 增量审四问（是否只修 R1 登记 findings；是否新增未经批准抽象；状态/事实源/fallback 是否无依据增加；是否留下双路径）；②对全量 `fb1c6ec..a9ee03b` 审此前未独立审查过的部分（卡 2 静默/健康车道、卡 3 历史收件箱、fix1 修复正确性）。审查对象冻结为上述 SHA 区间。

## 非目标

- 不修代码；不重开设计定稿；R1 已判 backlog 的 P3 清单（见 verdict 文件）不重复报。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：test -f docs/sessions/260822-2132-notify-attention/reviews/notify-r2-verdict.md
- **Diff-Lines-Target**：70
- **Diff-Lines-Hard**：220
- **阶段**：reviewing
- **锁定决策**：
  1. 先读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`（绝对路径）；再读 R1 verdict：`docs/sessions/260822-2132-notify-attention/reviews/notify-t1-verdict.md`。
  2. 风险等级 infra 例外；P1 红线：进程崩溃路径、静默丢事件/丢订阅、SW 缓存化/respondWith、推送故障传播终端会话、停机顺序丢在途推送、状态目录跨端口共享。收敛：连续 2 轮无新增 P1（R1 有 P1 已修；本轮与下轮均无新增 P1 才收敛）。
  3. 本轮视角与 R1 不同（R1=卡 1 正向审查）：①增量四问对抗视角（构造能绕过修复的输入：push 抛错矩阵、panel fetch reject 路径、SW ready 挂起、prune/inFlight 竞态窗口、trim setImmediate 时序）；②卡 2 状态机轴表逐格对抗（伪定时器边界：恰好 busyMs/quietMs 边界、让位窗口边界、冷却内新 busy、enabled 切换）；③卡 3 端点钳制与 fail-safe。每条结论须有本轮新执行的命令/探针输出佐证，不照搬 OCR。
  4. OCR 前置已跑（status=reviewed，90 条，envelope 在 /tmp/opencode/ocr-r2.json 可读）；逐条独立核实后才可采信。
  5. spec：`docs/sessions/260822-2132-notify-attention/HANDOFF.md` 不变式节 + 卡面 `docs/sessions/cards/notify-t2-internal-lanes.md`、`notify-t3-history-inbox.md`、`notify-t1-fix1.md`（不变式轴表/锁定决策）。每条意见注明违反哪条；无法溯源降一级。
  6. 已知噪音勿报：serve-abuse 偶发（两树 ~1/6）；webkit e2e 跳过；push 端点不回环=锁定决策；R1 backlog P3 清单。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：a9ee03b（审查范围终点）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建（检出 a9ee03b）
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与终审；本卡执行者即独立审查人

## 修改边界

- **允许**：`docs/sessions/260822-2132-notify-attention/reviews/notify-r2-verdict.md`（仅此一个新增文件）
- **禁止**：一切源码/测试/配置改动；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：docs/sessions/260822-2132-notify-attention/reviews/notify-r2-verdict.md
- **高风险区域**：无（只写一个 verdict 文件）

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：verdict 包含：①增量审四问逐问答案（任一不过按新增 P1 计数）；②R1 的 8 条 findings 逐条复验已消除；③卡 2/3 全量 findings（分级/证据/违反条款）；④熵增维度结论；⑤最终 verdict：pass/fail + 「新增 P1 数」显式数字。
- **相关测试**：只读验证命令自选（vitest 单文件/tsx 探针），命令与结果原文进 verdict。
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

  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。审出 P1 是 review 卡的正常产出，不是执行器失败；只有审查工作本身没做完才写 failed。

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md 正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取）**：feat/notify-attention a9ee03b = t1(7c)+t2(6c)+t3(4c)+fix1(5c)+合并；主脑已跑 pnpm test 907/907、tsc、check、build:dist 全绿（notify-t1-f1 worktree）；t2 时序三件套 5 连跑绿；t3 红验红。R1 verdict 已入库。
- **机理/根因陈述**：无。
- **已完成**：全部实现+修复；R1。
- **未完成**：R2 独立审查。
- **关键决策**：本轮=增量四问+未审部分全量+对抗视角。
- **已否决方案**：R1 backlog 项本轮不修不报。
- **修改文件**：仅 verdict 文件。
- **测试及结果**：见现场事实。
- **已知问题**：见锁定决策 6。
- **下一步唯一动作**：读 review-discipline + R1 verdict → 增量四问 → 全量审 → verdict。
