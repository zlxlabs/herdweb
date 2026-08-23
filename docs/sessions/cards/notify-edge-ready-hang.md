# 任务卡：面板 getRegistration 修复 — Edge 151 的 serviceWorker.ready 永久挂起

## 目标

主脑已复现的浏览器兼容缺陷：**Edge 151（桌面+Android 同内核）上 `navigator.serviceWorker.ready` 永远不 resolve——即使该 scope 的 worker 已是 active 状态**。实测证据（Edge 151.0.4129，真实 tailscale URL）：

```text
getRegistrations() → [{ scope: '…/herdweb-notify/', active: 'activated', waiting: false, installing: false }]
register() 手动重注册 → ok，active: true
Promise.race([serviceWorker.ready, 6s 超时]) → { resolved: false }   ← ready 挂死
（Chrome 124 与 iOS Safari 17.4 同 URL 下 ready 秒解——仅 Edge 151 异常）
```

通知面板的 `getRegistration()`（src/controls/notify-panel.ts:198-209）以 `Promise.race([ready, 5s])` 为唯一来源 → Edge 151 上恒 null → 开关变灰（disabled）、subscribe/unsubscribe/refreshToggle 全部走「SW unavailable」分支，订阅永远无法完成（真机实证：Edge 4 次页面加载 0 次 vapid-key/subscribe 请求）。

修复后面板在 Edge 151 上开关可用、订阅流程完整走通。

## 非目标

- 不改 SW 本体、服务端、subscribe/unsubscribe 业务逻辑。
- 不引入浏览器 UA 嗅探。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：100
- **Diff-Lines-Hard**：250
- **阶段**：repairing
- **root_cause_group**：以 `serviceWorker.ready`（浏览器生命周期承诺，Edge 151 实现缺陷挂死）作为 SW 可用性的唯一判定来源
- **introduced_by_commit**：bce447f（面板初版 getRegistration）
- **open_findings**：
  - F-P1-6：Edge 151 ready 挂起 → 面板在 Edge 上完全不可用
- **锁定决策**：
  1. **重写 `getRegistration()`**（保持签名与语义：返回 `ServiceWorkerRegistration | null`）：
     1. `const reg = await navigator.serviceWorker.getRegistration()`（立即返回当前 scope 的注册，无生命周期等待）；
     2. 若 `reg` 存在：`reg.active` 直接返回；否则轮询等待激活（250ms 间隔、至多 2s，等 `reg.installing`/`reg.waiting` 转 active）；轮询结束仍无 active 也**返回 reg**（pushManager 挂在 registration 上，订阅是否可行让后续 API 自己说话，错误已有可见性）；轮询实现不引入新状态——局部 async 即可；
     3. 若无 reg（首次访问页面加载时注册仍在途）：保留现 `Promise.race([ready, 5s 超时])` 作为冷启动路径；
     4. 顶部注释写明原因：Edge 151 的 ready 即使 active worker 存在也永不 resolve（主脑实测锚点），故热路径必须用 getRegistration。
  2. **SW_READY_TIMEOUT_MS 常量保留**（冷启动路径仍用）；轮询参数用内联字面量（250 / 2000），不新增配置。
  3. **测试**（tests/notify-panel.test.ts）：
     - 新增「ready 永不 resolve + getRegistration 返回带 active 的注册 → toggle 未禁用、状态行非 unavailable」（用挂死的 ready Promise stub 锁死 Edge 形态——旧实现下该测试必红，即红验锚点）；
     - 新增「getRegistration 返回 installing 注册 → 2s 轮询窗口内转 active → 返回该注册」（fake timers 推进）；
     - 既有用例（SW 缺失 → null → 禁用）继续绿：getRegistration 与 ready 均无注册时仍走 5s 超时路径。
  4. 手测矩阵由主脑执行（Edge 151 桌面真探针 + Chrome 124 模拟器 + 既有 happy-dom 套件），执行器不需要浏览器环境。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：395509b（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 Edge 151 桌面探针与 Chrome 124 模拟器做终验）

## 修改边界

- **允许**：`src/controls/notify-panel.ts`（仅 getRegistration 与注释）、`tests/notify-panel.test.ts`
- **禁止**：其余一切文件；`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/controls/notify-panel.ts tests/notify-panel.test.ts
- **高风险区域**：无

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 3 两条新测试绿；旧实现下第一条红（执行器 stash 验证，报告贴两态）。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：getRegistration 签名不变。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 四道全绿（报告贴结果）。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：实现+测试一次 commit 即可（小卡）。
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

- **现场事实（主脑预取）**：Edge 151 探针输出见目标节（active 注册存在 + ready 6s 不 resolve）；真机 Edge 4 次加载 0 订阅请求；现实现 src/controls/notify-panel.ts:198-209（SW_READY_TIMEOUT_MS=5000 在 :18）；既有面板测试均以「ready 正常 resolve」为前提 stub。
- **机理/根因陈述**：`Edge 151 serviceWorker.ready 不随 active worker resolve（浏览器缺陷）→ 面板唯一判定路径恒超时`（证据锚点：主脑 msedge 151 探针 resolved:false + 真机抓包 0 subscribe）。
- **已完成**：根因定位与本地复现（主脑）。
- **未完成**：修复+测试。
- **关键决策**：热路径 getRegistration+轮询；冷启动保留 ready-race。
- **已否决方案**：UA 嗅探；延长 ready 超时（挂死与时长无关）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：重写 getRegistration + 两条新测试并提交。
