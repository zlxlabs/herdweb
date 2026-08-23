# 任务卡：通知面板 · 权限可见性与自诊断（状态行 + 检测/重新授权按钮）

## 目标

通知面板当前的用户痛点：授权弹窗弹过之后**页面看不到权限状态**，用户无法判断授权是否成功，也无法在权限被拒后重新发起授权（Chrome 对 denied 站点不再弹窗，必须引导去站点设置）。给面板加两样东西：

1. **常显权限状态行**：面板打开即显示 `通知权限：已允许 / 未决定 / 已拒绝 / 此浏览器不支持`。
2. **「检测并重新授权」按钮**：点击后 ①调 `Notification.requestPermission()`（default→弹授权框；granted→无操作返回 granted；denied→静默返回 denied）②刷新权限行与订阅状态 ③denied 时显示引导文案「浏览器已拒绝通知：地址栏锁图标 → 网站设置 → 通知 → 允许，改完回来再点本按钮」。

诊断三要素最终对用户可见：权限行（本卡）+ 开关是否可点（既有，SW 可用性）+ 开关是否勾选（既有，订阅状态）。

## 非目标

- 不改 subscribe/unsubscribe 逻辑、服务端、SW。
- 不改既有 status 文案（"Not subscribed"/"Subscribed" 等保持原样，控制范围）。
- 不做自动轮询；面板打开 + 按钮点击时刷新即可。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：300
- **阶段**：implementing
- **锁定决策**：
  1. **权限行**：`el('p', { class: 'wt-notify-perm-status' })`，置于 toggleRow 上方；文本中文：`通知权限：已允许` / `通知权限：未决定` / `通知权限：已拒绝（需在浏览器站点设置中允许）` / `此浏览器不支持通知`。读取函数 `describePermission(): string`，带 Notification API 存在性守卫（`typeof Notification === 'undefined'` → 不支持；此为 R1 backlog F-P3-1 的转正——现在有了第二个消费者，说明写进报告）。刷新时机：面板 `open()`、perm 按钮点击后、subscribe()/unsubscribe() 完成后。
  2. **按钮**：`el('button', { type: 'button', class: 'wt-notify-perm-check' }, '检测并重新授权')`，置于 toggleRow 与 testBtn 之间；onTap 绑定（普通 button，无 checkbox 竞态问题）。handler：①`Notification.requestPermission()`（不支持时跳过）②更新权限行 ③调 `refreshToggle()` ④denied 时 setStatus 引导文案（中文，同锁定决策 1 括号内文案）；granted 时 setStatus `'权限已允许，可打开推送开关'`；default 时（用户刚把弹窗关掉）setStatus `'未决定——再次点击可重新弹出授权'`。
  3. **样式**：`.wt-notify-perm-status` 沿用 `.wt-notify-status` 的视觉风格（次要文本色）；`.wt-notify-perm-check` 沿用 `.wt-notify-test` 按钮样式。styles/base.css 只加这两条，放在既有 #wt-notify 节内。
  4. **测试**（happy-dom，扩 tests/notify-panel.test.ts）：
     - 权限行渲染四态表驱动（granted/default/denied/undefined Notification）
     - 面板 open() 后权限行有文本
     - perm 按钮 click → requestPermission 被调用、权限行更新（mock Notification.requestPermission 返回 'granted'）
     - denied → setStatus 含「站点设置」引导文案
     - Notification 不存在 → click 不抛错、显示不支持
     - mock 手法：vi.stubGlobal('Notification', …) 或注入，注意恢复（afterEach unstub）。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：2044e18（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 Android 模拟器真 Chrome CDP 环境做终验）

## 修改边界

- **允许**：`src/controls/notify-panel.ts`、`styles/base.css`（仅 #wt-notify 节内两条）、`tests/notify-panel.test.ts`
- **禁止**：其余一切文件；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/controls/notify-panel.ts styles/base.css tests/notify-panel.test.ts
- **高风险区域**：无

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 4 全部测试绿。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：面板 DOM 新增两个元素（选择器 `.wt-notify-perm-status`、`.wt-notify-perm-check`），e2e/主脑终验依赖这两个选择器。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿（四道都要跑，报告贴结果）。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：实现+样式一次、测试一次，≥2 commits。
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

- **现场事实（主脑预取）**：面板现状 src/controls/notify-panel.ts:128-154（元素装配）、open() :299-304（refreshToggle+fetchHistory）。真机 Chrome 已实测：denied 状态 requestPermission 静默返回不弹窗（必须引导站点设置）；default 状态弹系统对话框（模拟器 CDP 实测 adb 点允许后 granted→Subscribed 全链路通）。
- **机理/根因陈述**：无（可见性功能卡）。
- **已完成**：主脑模拟器真 Chrome 全链路验证（代码无缺陷，纯可见性/可操作性缺口）。
- **未完成**：全部实现。
- **关键决策**：常显权限行 + 单按钮双用（检测+重授权）；Notification 守卫转正。
- **已否决方案**：自动轮询权限（无必要复杂度）；改既有英文文案（扩范围）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：按锁定决策实现并提交。
