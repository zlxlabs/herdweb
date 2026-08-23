# 任务卡：通知链路可观测性 — 面板订阅错误浮出 + 服务端推送结果日志

## 目标

真机排障时两处静默导致无法定位：

1. **面板**：`subscribe()` 中 `registration.pushManager.subscribe({...})` 无 try/catch（src/controls/notify-panel.ts:250-253，try 只包了后面的 POST fetch）。真机上这一步抛错（如 "Registration failed - permission denied"、iOS PWA 特有错误）时：async IIFE 变未处理 rejection，**状态行不变、开关停在开**，用户零反馈。修复：包 try/catch，setStatus 显示 `'订阅失败（见浏览器控制台）'` + console.error 完整错误（字面量前缀 `herdweb: push subscribe failed`）+ `toggle.checked = false`。
2. **服务端**：`pushToAll` 对推送结果零日志（src/notify/service.ts）——404/410 移除订阅是静默的（实测：订阅文件 12:23 被写成空数组但 journal 无任何痕迹，无法区分「退订」还是「推送判无效移除」）。修复：三行日志——①成功：`herdweb: notify push delivered → ${new URL(endpoint).host}`（每个成功订阅一行）；②移除：`herdweb: notify subscription removed (stale ${statusCode}) → ${host}`；③空目标：`herdweb: notify push skipped — no subscriptions`（kind=test 也走这里，用户点测试按钮无订阅时服务端可见）。

## 非目标

- 不改订阅/推送逻辑本身；不加重试；不改 SW。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：80
- **Diff-Lines-Hard**：200
- **阶段**：implementing
- **锁定决策**：
  1. 面板 try/catch 位置：只包 `pushManager.subscribe` 调用（vapid-key fetch 已有各自处理）；catch 中 console.error 原始 error（完整对象，非仅 message）。
  2. 服务端日志用 console.log/error 既有风格；`new URL()` 失败（畸形 endpoint）时降级打印 endpoint 前 40 字符，不抛错。
  3. 测试：①tests/notify-panel.test.ts 补「subscribe 时 pushManager.subscribe reject → 状态行含『订阅失败』、toggle 复位 false、POST /subscribe 未发起」；②tests/notify-push.test.ts 用 vi.spyOn(console, 'log') 断言：404 移除路径打出 removed 日志、零订阅路径打出 skipped 日志（防回归恒真：断言日志内容含 host/stale 关键词）。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：e8e15fa（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持模拟器真 FCM + 真机排障上下文做终验）

## 修改边界

- **允许**：`src/controls/notify-panel.ts`、`src/notify/service.ts`、`tests/notify-panel.test.ts`、`tests/notify-push.test.ts`
- **禁止**：其余一切文件；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/controls/notify-panel.ts src/notify/service.ts tests/notify-panel.test.ts tests/notify-push.test.ts
- **高风险区域**：无

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 3 两条测试绿。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：不变。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 四道全绿（报告贴结果）。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：面板一次、服务端+测试一次，≥2 commits。
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

- **现场事实（主脑预取）**：真机症状=授权成功但测试无反应（双平台一致）；服务端订阅文件 12:23 被写为空数组且 journal 零痕迹；模拟器真 FCM 全链路当前正常（复现通过）。subscribe 无 try/catch 位置：src/controls/notify-panel.ts:250-253；pushToAll 静默移除位置：src/notify/service.ts pushToAll 内 401/404/410 分支与 allSettled 后写回。
- **机理/根因陈述**：`async IIFE 内未捕获 rejection → UI 零反馈`（证据锚点：notify-panel.ts:250 subscribe 调用无 try/catch）；`静默移除无日志 → 无法归因`（证据锚点：service.ts pushToAll）。
- **已完成**：主脑复现与定位。
- **未完成**：两处修复+测试。
- **关键决策**：见锁定决策。
- **已否决方案**：无。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：实现并提交。
