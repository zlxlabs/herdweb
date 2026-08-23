# 任务卡：通知面板 · Service Worker 状态可见性 + 重新注册按钮（Edge Android 排障）

## 目标

真机（Edge Android 151）上 SW 注册不存在（`getRegistration()` null + ready 超时 → 开关灰、「Service worker unavailable」），但注册失败原因被静默吞（client-entry 的注册在页面加载时执行，失败仅 console.error，用户不可见）。给面板补第二组自诊断（与既有权限诊断同构）：

1. **SW 状态行**：面板打开即显示 `Service Worker：已激活 / 注册中 / 未注册 / 注册失败（<错误>）/ 此浏览器不支持`。
2. **「重新注册 Service Worker」按钮**：直接调 `navigator.serviceWorker.register(joinBasePath(basePath, '/sw.js'), { scope })`，成功 → 刷新状态行与订阅开关；失败 → 状态行显示 `注册失败（<error.message>）`（完整错误字符串，这是本卡的诊断输出，用户会把它拍照/抄回来）。

## 非目标

- 不改 getRegistration/订阅逻辑、服务端、SW 本体、client-entry 的启动注册。
- 不做自动重试。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：300
- **阶段**：implementing
- **锁定决策**：
  1. **元素**：`el('p', { class: 'wt-notify-sw-status' })`（置于权限行 `.wt-notify-perm-status` 之后）；`el('button', { type: 'button', class: 'wt-notify-sw-check' }, '重新注册 Service Worker')`（置于 perm-check 按钮之后）。onTap 绑定（普通 button）。
  2. **状态读取函数** `refreshSwStatus(): Promise<void>`：复用面板内 `getRegistration()`——null 且 `!('serviceWorker' in navigator)` → `此浏览器不支持`；null → `未注册`；有 registration 且 `reg.active` → `已激活`；有 registration 无 active（installing/waiting）→ `注册中`。写入状态行。刷新时机：面板 `open()`、SW 按钮点击后、订阅成功后。
  3. **按钮 handler**：try { await register(...) → setStatus `'SW 已注册'` + refreshSwStatus() + refreshToggle() } catch (error) → 状态行 `注册失败（${String(error.message ?? error)}）` + console.error（字面量前缀 `herdweb: service worker registration failed`）。register 的 path/scope 构造与 client-entry 一致（joinBasePath + documentRoute 风格；scope `${basePath === '/' ? '/' : basePath + '/'}`）。
  4. **样式**：`.wt-notify-sw-status` 同 `.wt-notify-perm-status`；`.wt-notify-sw-check` 同 `.wt-notify-perm-check`。
  5. **测试**（tests/notify-panel.test.ts 扩，沿用既有 stub 手法）：
     - 状态行表驱动：不支持（无 serviceWorker 属性）/ 未注册（getRegistration null 且 ready 超时——stub ready 为永不 resolve 的 Promise + fake timers 或短 SW_READY 等待）/ 已激活（active 存在）/ 注册中（installing 存在无 active）。
     - 按钮成功：stub register resolve → refreshToggle 被触发（toggle.disabled false）+ 状态行「已激活」。
     - 按钮失败：stub register reject（message 'boom-script-url'）→ 状态行含「注册失败」与 'boom-script-url'，console.error 被调（spy）。
     - open() 后状态行有文本（非空）。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：745de7d（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 Edge 151 桌面探针做终验）

## 修改边界

- **允许**：`src/controls/notify-panel.ts`、`styles/base.css`（#wt-notify 节内两条）、`tests/notify-panel.test.ts`
- **禁止**：其余一切文件；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/controls/notify-panel.ts styles/base.css tests/notify-panel.test.ts
- **高风险区域**：无

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 5 全部测试绿。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：面板新增选择器 `.wt-notify-sw-status`、`.wt-notify-sw-check`（主脑终验依赖）。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 四道全绿（报告贴结果）。
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

- **现场事实（主脑预取）**：面板现状 src/controls/notify-panel.ts（getRegistration 热路径 :198 起、perm 元素 :154-158、open() :299 起）；client-entry.ts:838-848 启动注册（失败仅 console.error）。桌面 Edge 151 同 URL 注册成功（active），用户设备 Edge Android 151 注册不存在——差异原因待本卡诊断输出。
- **机理/根因陈述**：`启动注册失败仅进控制台，面板无重试无错误显示 → 设备侧注册失败不可诊断`（证据锚点：client-entry.ts:845-847 catch 静默）。
- **已完成**：主脑复现环境搭建（桌面 Edge 探针）。
- **未完成**：全部实现。
- **关键决策**：与权限诊断同构（状态行+按钮）；错误字符串完整上屏。
- **已否决方案**：自动重试循环；UA 嗅探。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：实现并提交。
