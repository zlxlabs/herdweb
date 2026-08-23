# 任务卡：注意力层 v1 · 卡 1 独立审查 R1（推送管道 diff fb1c6ec..c188960）

## 目标

对 herdweb 注意力层卡 1（推送管道）的完整 diff 做独立审查，产出 verdict 文件。审查对象冻结为提交范围 `fb1c6ec..c188960`（分支 card/notify-t1，勿写分支名进结论）；审查期间出现的新提交不属于本轮对象。

## 非目标

- 不修代码、不重构、不加测试——只审查并产出 findings + verdict。
- 不重开设计定稿（CEO+Eng review 已 CLEAR）；与文档化契约冲突的意见需先举证契约本身有问题，否则不成立。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：test -f docs/sessions/260822-2132-notify-attention/reviews/notify-t1-verdict.md
- **Diff-Lines-Target**：60
- **Diff-Lines-Hard**：200
- **阶段**：reviewing
- **锁定决策**：
  1. 先读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`（绝对路径，跨仓有效），按其规则执行。
  2. 风险等级：infra 例外（功能集中在状态/失败路径）——P1 红线：进程崩溃路径、静默丢事件、SW 缓存化、把推送故障传播给终端会话。收敛条件：连续 2 轮无新增 P1。
  3. spec 文档：`docs/sessions/260822-2132-notify-attention/HANDOFF.md`（不变式清单在其「不变式」节）+ 卡面 `docs/sessions/cards/notify-t1-push-pipeline.md`（锁定决策 14 条+不变式轴表）。每条意见注明违反 spec 哪条；无法溯源的意见降一级。
  4. OCR 前置扫描已跑（status=reviewed，59 条）。主脑预分诊如下，reviewer 须逐条独立核实后才可采信（高精确低召回，不照搬理由）：
     - 预登记 P1 候选 1 条：`src/notify/service.ts` dispatchEvent 的 pushToAll promise 无 catch，ensureVapid/writeSubscriptions 抛错时成未处理 rejection，Node 默认行为可致死整个 serve 进程（终端会话陪葬）——对照 HANDOFF 不变式「服务自身异常不再是盲区」与卡面 fail-safe 纪律判定级别。
     - 预登记 P2 候选：①`src/notify/state.ts` writeJsonFileAtomic 的 rename 后 chmod 段用「重读+重写全文」实现，冗余且引入 TOCTOU 窗（tmp 建立时已带 mode，rename 保留 mode，整段可删/改 chmod）；②面板 subscribe 的 POST /api/push/subscribe 失败时浏览器侧订阅成孤儿（无本地回滚 unsubscribe）；③面板 await navigator.serviceWorker.ready 无超时，SW 安装失败时面板永久挂起（对照面板 fail-safe 不变式）；④Notification API 无存在性守卫（旧 WebView 直接 ReferenceError）。
     - 其余 ~50 条为熵增/风格/防御性建议（P3 及以下），按「可接受不修记 backlog」处理，除非命中 P1 红线。
  5. 已知噪音（勿报）：tests/serve-abuse.test.ts oversized 用例两树共有的负载敏感偶发（~1/6）；webkit e2e 跳过属记录在案的稳定化决策；push 端点不回环是锁定决策。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：fb1c6ec728e842e75f853e38e2eb078168ff8889（审查范围终点 H0=c188960）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建（检出至 c188960）
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与终审；本卡执行者即独立审查人

## 修改边界

- **允许**：`docs/sessions/260822-2132-notify-attention/reviews/notify-t1-verdict.md`（仅此一个新增文件）
- **禁止**：一切源码/测试/配置/文档改动；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：docs/sessions/260822-2132-notify-attention/reviews/notify-t1-verdict.md
- **高风险区域**：无（只写一个 verdict 文件）

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：verdict 文件包含：①每条 finding 的分级（P1/P2/P3）、证据（文件:行）、违反的 spec 条款；②对预登记 4 条的逐条核实结论（采信/不采信+理由）；③熵增审查维度结论（新增抽象/文件/状态逐个过「第二消费者」）；④最终 verdict：pass / fail（存在未解决 P1 即 fail）；⑤建议修复清单（按「优先做减法」纪律）。
- **相关测试**：无需跑新增测试；审查中如需运行验证命令，用只读方式（pnpm test / vitest 单文件 / node 脚本）在 worktree 内执行，命令与结果原文进 verdict。
- **概率性验收**：不适用。
- **接口契约**：不适用。
- **lint / typecheck / build**：不适用（只读审查）。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree；不改动被审树。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：verdict 文件一次成型一次 commit。
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

- **现场事实（主脑预取）**：审查范围 fb1c6ec..c188960 = 31 files, +2189/−13；主脑已跑 pnpm test（849，1 条既有负载偶发）、tsc --noEmit、build:dist、check、test:pw（chromium 绿/webkit 记录跳过）、curl 冒烟 8/8、红验抽查红。OCR 扫描 envelope 在 /tmp/opencode/ocr-t1.json（59 条 findings，reviewer 可读该文件辅助，但结论须独立）。
- **机理/根因陈述**：无。
- **已完成**：实现（卡 1）、主脑验收、OCR 前置。
- **未完成**：独立审查。
- **关键决策**：审查范围冻结 H0；infra 例外收敛线。
- **已否决方案**：无。
- **修改文件**：仅 verdict 文件。
- **测试及结果**：见现场事实。
- **已知问题**：见锁定决策 5 已知噪音。
- **下一步唯一动作**：读 review-discipline → 全量审 diff → 写 verdict。
