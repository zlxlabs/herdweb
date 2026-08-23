# 任务卡：Service Worker scope 覆盖裸 basePath（修复无尾斜杠 URL 下通知永久不可用）

## 目标

当用户用**不带尾斜杠**的地址访问（`https://host/herdweb-notify`，地址栏手输或书签的常见形态）时，
通知功能永久不可用：面板恒显示「Service Worker：未注册」+「Service worker unavailable or
timed out」，订阅开关恒灰。

根因（2026-08-23 真机 + 抓包实证，Edge for Android 151 / Android 10）：
客户端注册 Service Worker 时 scope 传的是 `${basePath}/`（**带**尾斜杠，即 `/herdweb-notify/`），
而页面 URL 是 `/herdweb-notify`（**不带**）。Service Worker 的 scope 是前缀匹配，
`/herdweb-notify` 不以 `/herdweb-notify/` 开头 → 当前页面**不在** scope 内，于是：

- `navigator.serviceWorker.register()` 照常 resolve（注册本身合法）→ 面板提示「已注册」
- `navigator.serviceWorker.getRegistration()`（无参，按当前页面 URL 匹配）→ 返回 undefined
  → 面板显示「未注册」
- `navigator.serviceWorker.ready`（等当前页面被 controller 接管）→ **永不 resolve**
  → 竞速超时 → 「unavailable or timed out」

用户改用带尾斜杠地址访问后，状态立刻变为「已激活」——根因确认。

**同时纠正一条既有误判**：`src/controls/notify-panel.ts` 中注释「Edge 151:
`serviceWorker.ready` never resolves even when an active worker exists for the scope」
是错误归因。`ready` 不 resolve 不是 Edge 缺陷，而是页面本就不在 scope 内。该注释必须
按本卡的真实根因改写，否则后人会继续绕着一个不存在的浏览器 bug 做补丁。

**服务端为何不能修**：`src/serve.ts:633` 已有裸路径 → `documentRoute` 的 308 重定向，
但生产部署经 Tailscale `serve` path-mount 反代，前缀在到达后端前已被剥掉（抓包实证：
浏览器请求 `/herdweb-notify` 与 `/herdweb-notify/`，后端一律看到 `/`），后端无法区分，
该重定向永远命中不到。所以只能在客户端把 scope 放宽。

修复：把 SW 注册 scope 与 PWA manifest scope 从 `documentRoute(basePath)`（带尾斜杠）
放宽为裸 `basePath`（不带尾斜杠），使其同时覆盖 `/herdweb-notify` 与 `/herdweb-notify/…`；
并让面板不再依赖「当前页面归谁管」来查询状态。

服务端已经发出 `Service-Worker-Allowed: /herdweb-notify`（无尾斜杠，见
`src/serve.ts` 的 `/sw.js` 路由），放宽后的 scope 正是该头允许的范围 —— **服务端无需改动**。

## 非目标

- 不改服务端任何文件（`src/serve.ts`、`src/notify/**` 都不动；订阅回写竞态由并行卡 A 处理）。
- 不做 UA 嗅探、不加自动重试循环（已否决）。
- 不引入 Workbox，SW 仍然没有 fetch handler，v1 仍不用 `skipWaiting`。
- 不改 iOS 路径已验证通过的行为（iOS 从 manifest `start_url` 启动，本卡放宽 scope 对其是超集）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：200
- **Diff-Lines-Hard**：360
- **阶段**：repairing
- **锁定决策**：
  - SW 注册 scope = 裸 `basePath`（`basePath === '/'` 时为 `'/'`），不再是 `${basePath}/`。
  - manifest 的 `scope` 同步改为裸 `basePath`；**`start_url` 保持 `documentRoute(basePath)`
    不变**（带尾斜杠仍是首选落点，只是不再是唯一合法落点）。
  - 面板查询注册一律显式传 scope：`navigator.serviceWorker.getRegistration(<scopeUrl>)`，
    不依赖无参形式对当前页面 URL 的匹配。
  - 冷启动路径**移除**对 `navigator.serviceWorker.ready` 的依赖，改为轮询
    `getRegistration(<scopeUrl>)` 直到拿到带 `active` 的注册或超时。
  - 等待 active 的超时窗口从 2000ms 放宽到 15000ms（首次安装在低端 Android 上会超过 2 秒），
    且轮询期间面板状态行显示「注册中」而非直接判死。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：c51e8aa
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配独立 worktree
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：按 envelope 实际值回填
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收；执行器不得自评通过。

## 修复卡必填

- **root_cause_group**：SW/manifest scope 带尾斜杠，不覆盖裸 basePath 页面 URL；
  面板又用「当前页面归属」（无参 `getRegistration` 与 `ready`）来判定注册是否存在。
- **introduced_by_commit**：`pre-existing`（注意力层 v1 引入 SW 注册时即存在；
  执行器用 `git log -S "scope: basePath === '/'"` 取证并在报告写明实际 commit）。
- **open_findings**：
  1. `src/client-entry.ts` `registerServiceWorker`：scope 用 `${basePath}/`，不覆盖裸路径页面。
  2. `src/controls/notify-panel.ts` `getRegistration`：无参 `getRegistration()` + `ready` 竞速，
     在页面不在 scope 内时必然判死；且 2000ms 等待窗口过短。
  3. `src/controls/notify-panel.ts` 第 238-241 行注释对 Edge 151 的错误归因，须按真实根因改写。
  4. `src/pwa/manifest.ts`：`scope` 用 `documentRoute(basePath)`，同样不覆盖裸路径。
  5. `src/controls/notify-panel.ts` 的「重新注册」按钮：register resolve 即报成功，
     未校验注册是否真的覆盖当前页面；须改为注册后按新的轮询逻辑确认 active 再报成功。

## 修改边界

- **允许**：
  - `src/client-entry.ts`
  - `src/controls/notify-panel.ts`
  - `src/pwa/manifest.ts`
  - `tests/notify-panel.test.ts`
  - `tests/notify-panel-history.test.ts`（仅在被上述改动波及时）
  - `tests/pwa-manifest.test.ts`（若不存在则按实际 manifest 测试文件名，先 `grep -rn "start_url" tests/` 确认）
  - `tests/serve.test.ts` **仅限** manifest 内容断言那一处（若存在）；其余断言不得改
- **禁止**：
  - `src/serve.ts`、`src/notify/**`、`src/session*.ts`（卡 A 与服务端范围）
  - `src/sw-entry.ts`（SW 自身逻辑正确，不动）
  - `.github/workflows/`
- **Scope-Globs**：src/client-entry.ts src/controls/notify-panel.ts src/pwa/manifest.ts tests/notify-panel.test.ts tests/notify-panel-history.test.ts tests/pwa-manifest.test.ts
- **高风险区域**：
  - manifest `scope` 变更影响已安装的 PWA（用户 iPhone 上已安装并工作）。放宽是超集，
    但必须有测试锁死 `start_url` 未变、`scope` 覆盖 `start_url`。
  - `getRegistration` 是订阅、取消订阅、状态刷新三条路径的公共入口，改动波及全部面板行为。

## 不变式轴表

轴：页面 URL 形态 × basePath 形态

| basePath | 页面 URL | 期望 | 检测点 |
|---|---|---|---|
| `/herdweb-notify` | `/herdweb-notify` | scope 覆盖，注册可查到 | 表驱动测试（本卡核心回归） |
| `/herdweb-notify` | `/herdweb-notify/` | scope 覆盖，注册可查到 | 表驱动测试 |
| `/herdweb-notify` | `/herdweb-notify/index` 等子路径 | scope 覆盖 | 表驱动测试 |
| `/` | `/` | scope = `/`，行为不变 | 表驱动测试（回归保护） |

轴：注册状态 × 面板显示

| getRegistration(scope) 返回 | reg.active | 期望状态行 | 期望开关 | 检测点 |
|---|---|---|---|---|
| null（超时前仍无） | — | 「注册中」，超时后才「未注册」 | 灰 | 单测 |
| 有 reg | null（安装中） | 「注册中」，轮询至 active 或超时 | 灰 | 单测（假计时器） |
| 有 reg | 有 active | 「已激活」 | 可点 | 单测 |
| `serviceWorker` 不在 navigator | — | 「此浏览器不支持」 | 灰 | 单测 |

**禁止**在任何格子里再出现「等待 `navigator.serviceWorker.ready`」作为判定手段。

## 给执行器的一条要求

如果你认为轴表里某一格的期望值可疑、或与「目标」段的意图矛盾，
**必须在 report.md 里显式提出，不得默默按格实现。提出不算抗命，是本卡要的东西。**

## 完成条件

- **产物入库**：全部落盘产物提交到 delegate 分配的 `card/<worktree 名>` 分支；报告贴出
  `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。
- **行为验收**：以**不带尾斜杠**的 URL 打开页面，通知面板能显示「已激活」、订阅开关可点；
  带尾斜杠仍然正常；`basePath = /` 的默认部署行为不变。
- **相关测试**（全量跑，禁用 `-k` 子集）：
  - `pnpm exec vitest run tests/notify-panel.test.ts tests/notify-panel-history.test.ts tests/base-path.test.ts`
  - 先 `grep -rn "manifest" tests/` 找出全部 manifest 相关测试文件并全跑
  - `pnpm test`（全量）
  - `pnpm exec tsc --noEmit`
  - `pnpm run build:dist`
  - `pnpm run check`
  - `pnpm run lint:knip`
- **跨发布边界验收**：manifest 与 SW scope 是浏览器消费的发布契约，测试必须断言
  **实际渲染出的 manifest JSON 字节**（而非构造函数入参）中的 `scope` / `start_url` 值。
- **TDD 要求**：先写出「页面 URL 为裸 basePath 时面板判死」的失败测试（红），再改实现（绿），
  报告中贴出红→绿两次运行的实际输出片段。
