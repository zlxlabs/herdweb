# 任务卡：注意力层 v1 · fix5 — 订阅开关 touch 竞态（真机上永远走 unsubscribe 分支）

## 目标

修复 Android 真机上订阅链路完全不通的根因：通知面板的 Push 开关用 `onTap`（touchend 时跑 handler），而 checkbox 的 `checked` 要到 ~4ms 后合成 click 的 pre-click 激活才翻转。**真实触摸设备上 handler 永远读到翻转前的旧值**：用户打开开关 → handler 读到 false → 走 `unsubscribe()` 空转（无授权弹窗、无任何网络请求、状态不变）；重开面板 `refreshToggle` 读真实订阅态 → 开关回到空。桌面 click 路径先翻状态再进 handler，且 e2e 从未 tap 过这个开关（直接 POST 假订阅），所以 CI 全绿。

**主脑实测证据（真实 tailnet URL + Pixel 5 触摸仿真 + page.tap）**：
```text
修前（onTap）：toggle checked: false -> true；requestPermission calls: 0；fetches: []；status 不变
修后（change）：requestPermission calls: 1；subscribe calls: 1；fetches: [GET vapid-key, POST subscribe]；status "Subscribed"；服务端 push-subscriptions.json 落盘
```

## 非目标

- 不改 tap.ts 全局机制（键盘焦点语义有 11 处依赖，动它是另一个量级）；只改 notify 面板这一个 checkbox 的绑定。
- 不改 subscribe/unsubscribe 逻辑本身、服务端、SW。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：150
- **Diff-Lines-Hard**：400
- **阶段**：repairing
- **root_cause_group**：touchend 先于 checkbox pre-click 翻转的事件时序竞态（onTap 语义对 button 正确、对 checkbox 错误）
- **introduced_by_commit**：bce447f（面板初版）
- **open_findings**：
  - F-P1-4：toggle 用 onTap 绑定 → 真机订阅链路 0 触发（上列实测）
- **锁定决策**：
  1. **修法（已 scratch 验证）**：`onTap(toggle, …)` 改为 `toggle.addEventListener('change', …)`——change 在 checked 翻转后触发，触摸/鼠标同语义，且天然不会双触发（tap.ts 的 touch+合成 click 去重问题不存在）。原 handler 体（checked 分支判断）不变。代码处加一行注释说明为何不用 onTap（touchend 读到 pre-flip 状态，真机竞态）。
  2. **单测更新**（tests/notify-panel.test.ts）：现有 `checked=X; click()` 写法恰好掩盖竞态（happy-dom 的 click 先翻转再进 handler）。改为真实用户序列的等价模拟：直接派发 `change` 事件序列断言订阅/退订分支（保留 click 路径回归：`toggle.click()` 后 change 应被触发并走对应分支）。补一条显式回归：**不经过 click、只派发 touchend 时，不得触发任何订阅动作**（锁定竞态形态——用 `dispatchEvent(new Event('touchend'))` 后断言 fetch 零调用；此测试在旧 onTap 实现下必红，即红验锚点）。
  3. **e2e 新增真实触摸用例**（tests/playwright/notify.spec.ts，chromium-android 项目已带 `--enable-features=WebPush`）：Playwright chromium 无 FCM 集成，`pushManager.subscribe` 必抛 "Registration failed - permission denied"（主脑实测）——用 `page.addInitScript` stub `PushManager.prototype.subscribe/getSubscription`（返回固定 endpoint `https://local.invalid/device-N` + `getKey` 返回 65/16 字节确定性 buffer + 记录调用计数），`Notification.requestPermission` 包一层计数（底层走 Playwright granted 权限）。然后 `page.tap('.wt-notify-toggle')` 真触摸，断言：requestPermission 计数 ≥1、`GET /api/push/vapid-key` 与 `POST /api/push/subscribe` 发生、面板状态变 "Subscribed"、服务端 `push-subscriptions.json` 出现该 endpoint；再关面板重开，断言开关仍为 on（stub getSubscription 返回订阅 → refreshToggle 显示已订阅——锁用户「状态不保存」症状）。
  4. **服务端→推送服务投递腿集成测试**（新建 tests/notify-push-delivery.test.ts，node 环境）：起本地 http server 当假 push endpoint，把其 URL 作为订阅写入 push-subscriptions.json（服务端真实文件），`createNotifyService` + `dispatchEvent(kind=done)`，断言假 endpoint 收到 POST：`TTL: 3600`、`Authorization: WebPush ` 前缀（VAPID 签名）、`Crypto-Key` 头存在、body 非空（加密载荷）。这一腿此前只有 mock sendPush 的单测，从未验证真实 web-push 出站报文。
  5. e2e 里旧用例（直接 POST 假订阅）保留不动——它测服务端登记路径。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：ca65732（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 tailscale 实例与触摸仿真环境做终验）

## 修改边界

- **允许**：`src/controls/notify-panel.ts`（仅 toggle 绑定与注释）、`tests/notify-panel.test.ts`、`tests/notify-panel-history.test.ts`（如受影响）、`tests/playwright/notify.spec.ts`、`tests/notify-push-delivery.test.ts`（新建）
- **禁止**：`src/util/tap.ts`（全局机制不动）、服务端 src/notify/**、`src/sw-entry.ts`、`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/controls/notify-panel.ts tests/notify-panel.test.ts tests/notify-panel-history.test.ts tests/playwright/notify.spec.ts tests/notify-push-delivery.test.ts
- **高风险区域**：无（局部事件绑定变更）

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 2 的竞态回归测试在旧实现下红（执行器用 `git stash` 或临时还原验证一次，报告贴红绿两态输出）；锁定决策 3/4 新用例绿。
- **相关测试**：`pnpm test`（全量）；`pnpm run test:pw -- tests/playwright/notify.spec.ts`（chromium-android 用例绿）。
- **概率性验收**：不适用。
- **接口契约**：不变。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿。
- **截图或探活**：报告贴红验两态输出。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：修复+单测一次、e2e+投递腿一次，≥2 commits。
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

- **现场事实（主脑预取）**：竞态已用真实触摸探针钉死（见目标节输出）；修法已 scratch 验证（change 事件全链路通，服务端文件落盘）。Playwright chromium 无 FCM 的事实由主脑双探针确认（headless+headed 均 "Registration failed - permission denied"）。tests/notify-panel.test.ts:69-70/:133-134 的 `checked=X; click()` 写法掩盖竞态的机理已核实。真机症状（无授权弹窗、状态不保存）与竞态机理逐条对上。
- **机理/根因陈述**：`touchend handler 读 pre-click checkbox 状态 → 恒走反向分支`（证据锚点：src/util/tap.ts:33-41 touchend 即跑 handler + 主脑 page.tap 探针 requestPermission=0/fetches=[]）。
- **已完成**：根因定位、修法验证（主脑 scratch）。
- **未完成**：正式修复+三层测试。
- **关键决策**：change 事件替代 onTap；tap.ts 不动；stub pushManager 是 e2e 在无 FCM 环境的唯一可行缝。
- **已否决方案**：改 tap.ts 全局语义（11 处键盘焦点依赖）；preventDefault touchend（tap.ts 注释已载明历史原因）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：按锁定决策修 toggle 绑定 + 三层测试。
