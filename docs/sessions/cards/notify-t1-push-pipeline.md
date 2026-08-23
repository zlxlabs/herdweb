# 任务卡：注意力层 v1 · 卡 1 推送管道（events API + Web Push + SW + 订阅面板）

## 目标

在 herdweb serve 里建成完整推送管道：本地事件入口 `POST {basePath}/api/events`（校验/限流/去重/落盘 → 202，推送异步）、Web Push 订阅端点、首个 service worker（`{basePath}/sw.js`）、CSP 放行、停机排空框架、config `notify.*`、客户端「通知」设置面板（订阅开关 + 测试按钮 + iOS 主屏引导）。交付后用户可在手机 PWA 完成订阅并收到测试通知。设计定稿全文见 `docs/sessions/260822-2132-notify-attention/HANDOFF.md`（自包含，冲突时以本卡为准）。

## 非目标

- 不做静默/健康车道（卡 2）、不做历史列表（卡 3）、不做 README/skill 文档（卡 4）。
- 不解析任何 agent/herdr 输出（spike NO-GO）；通知不带终端输出内容；不做通知内审批/深链 tab/多设备订阅 UI。
- 不改 agent-config 仓；不加 `failed` kind；SW 不加 fetch handler（不得缓存、不得干扰重连语义）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：1200
- **Diff-Lines-Hard**：2400
- **阶段**：implementing
- **锁定决策**：
  1. 状态目录按端口分仓：`${XDG_STATE_HOME:-~/.local/state}/herdweb/{port}/`（port=serve 实际监听口；7681 生产与 7691 debug 并发互不共享）。目录 0700；`vapid.json` 0600；其余 JSON 0644。
  2. 事件 schema v1：`{v:1, id, kind, session?, title, body?, reason?, ts}`；kind 白名单 `asking|done|ci-red|silence|health|test`（未知 kind、含 `tool` 或任何未知字段的载荷 → 400，fail-loud 不静默剥离）；title≤120、body≤200、reason≤120 服务端截断后存储/推送；原始 body >4 KiB → 413；`ts` 为 number；`v`≠1 → 400。
  3. `POST /api/events`：仅回环（复用 `src/serve.ts` 的 `isLoopbackHost`）+ 可选 bearer token（config `notify.token`，未配置则不校验）；单桶限流 60 events/min（滑动 60s 窗口）超限 429；按 id 去重（内存 Set+FIFO 队列，容量 1000，进程生命周期，重复 id 仍回 202 但不落盘不推送）；校验+落盘成功后立即 202，推送异步发送。kind=test：id 缺省时服务端填 `test:{自增}`，绕过去重与落盘（连点两次都到）。
  4. 鉴权边界拆分（HANDOFF「同鉴权」的工程化解读，已记录的偏差）：回环+token 只加在 `POST /api/events`（事件注入是信任边界）；`/api/push/subscribe`、`DELETE /api/push/subscription`、`GET /api/push/vapid-key`、`GET /api/events/history`（卡 3）是手机浏览器要打的端点，走既有 origin/host-header 中间件 + 与 events 相同机制的限流，不回环、不带 token。
  5. Web Push 用 `web-push`（`pnpm add --save-exact` 钉死版本）。VAPID 存 `{stateDir}/vapid.json`（serve 启动检测缺失自动生成 + 启动日志一行提示）；config `notify.vapid.{subject?,publicKey?,privateKey?}` 可整体覆盖（轮换用，缺省 `mailto:herdweb@localhost`）。订阅数组存 `push-subscriptions.json`（多设备预留，v1 UI 单设备）；推送 401/404/410 → 删该订阅并落盘；每订阅记录 `lastSuccessAt`（订阅时初始化、推送成功更新），90 天未成功推送的订阅在 serve 内 24h `setInterval` 顺扫清理；逐订阅 `Promise.allSettled` 隔离；TTL 3600（过时事件不补吵，历史可回看）。
  6. 推送消息 payload = 事件 JSON 本体（截断后）。
  7. 事件历史落盘 `events.jsonl`：O_APPEND 一行一 JSON（kind=test 不落盘）；追加时行数 > 2×`notify.history.limit`（默认 200）则重写保留最近 limit 行（tmp+rename 原子替换）。原子写 helper（tmp+rename+chmod）只服务 vapid/subscriptions/events 重写/last-session 四类 JSON。
  8. SW：serve.ts 经 `routeVariants` 加 `GET {basePath}/sw.js` 路由，响应头 `Content-Type: application/javascript` + `Service-Worker-Allowed: {basePath}`（basePath≠/ 时 scope 必须成立）；源码 `src/sw-entry.ts` 为独立 IIFE entry，进 `build.ts` 在线打包与 `scripts/build-overlay.ts` 预构建（`dist/sw.iife.js`）两条路径。handler 全集 = install/activate（no-op）、`push`（解析 JSON → `showNotification(title, {body, tag: kind:session, data: event})`）、`notificationclick`（close → `clients.matchAll({type:'window', includeUncontrolled:true})` 有则 focus 首个，空则 `clients.openWindow(scope)`）、`pushsubscriptionchange`（重新 subscribe——需先 `fetch(scope+'api/push/vapid-key')` 拿公钥——然后 DELETE 旧 endpoint 再 POST 新订阅）。**没有 fetch handler，永不 `respondWith`**；SW 内相对 URL 一律以 `self.registration.scope` 为基拼接；v1 不用 `skipWaiting`。
  9. `client-entry.ts` 在 load 后注册 SW（`${basePath}sw.js`，basePath 来自 `src/base-path.ts`），注册失败静默降级（SW 故障不得影响终端核心功能，fail-safe）。
  10. CSP：`buildSecurityHeaders` 的 CSP 串（src/serve.ts:168）追加 `worker-src 'self'`；同步更新 `tests/serve.test.ts` 的 CSP 快照断言。
  11. 停机排空框架：现状 PTY exit 即 `server.close()`（会掐死在途推送）。改为 PTY exit → `await notifyDrain()`（等在途推送 `Promise.allSettled`，上限 10s 防悬挂）→ `server.close()`。notifyDrain 留出卡 2 插入 last-session 写入/health 事件的挂点（一个函数即可）。
  12. config 新键（config-schema.ts Valibot strictObject 风格 + config.ts defaults）：`notify.token?: string`、`notify.vapid.{subject?,publicKey?,privateKey?}`、`notify.history.limit: number = 200`、`notify.silence.{enabled=true, busyMs=30000, quietMs=180000, cooldownMs=600000}`（schema 本卡全量接入，静默行为卡 2 实现）。
  13. UI：☰ 抽屉加 🔔「通知」按钮 → 设置面板，模式仿 help overlay（`src/controls/help.ts` 的 setupHelpOverlay + index.ts DI 注入 `openNotifyPanel` 进 action registry；新增 action 依赖注入而非扩 discriminated union 新 type，与 openHelp 同构）。面板含：订阅开关（开 = `Notification.requestPermission` → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → POST subscribe；关 = 服务端 DELETE 该 endpoint + 本地 unsubscribe）、「发送测试通知」按钮（POST kind=test）、iOS 非 standalone（`matchMedia('(display-mode: standalone)')` 不匹配）时显示「添加到主屏幕」引导文案。面板 fail-safe：任何 notify UI 故障不得破坏既有控件（对齐 help overlay 纪律）。
  14. `GET {basePath}/api/push/vapid-key` 返回 `{publicKey}`（VAPID 公钥给浏览器 subscribe 用，无鉴权）。
- **任务类型**：backend-logic
- **复杂度**：L
- **Base commit**：fb1c6ec728e842e75f853e3842eb078168ff8889
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **子代理 fan-out**：允许派 explorer 子代理并行扫描，fork_turns=none 防上下文污染；并行写仍受一支笔原则约束
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收；审查按 review-discipline 纪律另行派卡

## 修改边界

- **允许**：`src/notify/**`（新建 events/state/push/service/routes 等）、`src/serve.ts`（路由注册、CSP、停机序列、SW 路由）、`src/config.ts`、`src/config-schema.ts`、`src/types.ts`（如需 NotifyEvent 类型）、`src/actions/registry.ts`（notify 面板动作）、`src/controls/notify-panel.ts`（新建）、`src/index.ts`（DI 接线）、`src/client-entry.ts`（SW 注册）、`src/sw-entry.ts`（新建）、`build.ts`、`scripts/build-overlay.ts`、`styles/base.css`、`package.json`、`pnpm-lock.yaml`、`tests/serve.test.ts`、`tests/notify-*.test.ts`（新建）、`tests/playwright/notify.spec.ts`（新建）
- **禁止**：`src/session.ts`（卡 2 专属）、`src/notify/history.ts` 与 `src/notify/{silence,health}.ts`（卡 2/3 专属文件名，本卡不创建）；`.github/workflows/**`；`README.md`、`.agents/skills/herdweb-setup/SKILL.md`、`GOALS.md`（卡 4）；既有弱网/ASR/dpad 相关源码与测试
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/** src/serve.ts src/config.ts src/config-schema.ts src/types.ts src/actions/registry.ts src/controls/notify-panel.ts src/index.ts src/client-entry.ts src/sw-entry.ts build.ts scripts/build-overlay.ts styles/base.css package.json pnpm-lock.yaml tests/serve.test.ts tests/notify-events.test.ts tests/notify-push.test.ts tests/notify-state.test.ts tests/notify-panel.test.ts tests/playwright/notify.spec.ts
- **高风险区域**：serve.ts 停机序列（改错会让服务无法退出或丢在途推送）；CSP（回归会打死现有页面脚本）；SW 一旦带 fetch handler 即违反不变式

## 不变式轴表

轴 1：事件载荷 × 校验结果

| 载荷情形 | 期望 | 检测点 |
|---|---|---|
| 合法 v1 六 kind 之一、全字段合规 | 202、落盘（test 除外）、异步推送 | tests/notify-events.test.ts 表驱动 |
| kind=failed / 未知 kind / 含 tool 字段 / 含未知字段 / v≠1 | 400 | tests/notify-events.test.ts 表驱动 |
| title/body/reason 超长 | 202 且存储值被截到 120/200/120 | tests/notify-events.test.ts |
| 原始 body >4 KiB | 413 | tests/notify-events.test.ts |
| 61st 事件/min | 429 | tests/notify-events.test.ts |
| 重复 id | 202 但不重复落盘/推送 | tests/notify-events.test.ts |
| 重复 id 超出 1000 容量后（FIFO 驱逐） | 同 id 再次出现按新事件处理 | tests/notify-events.test.ts |
| kind=test 连发两次（无 id/同缺省） | 两次都推送、都不落盘 | tests/notify-events.test.ts |

轴 2：订阅生命周期 × 推送结果

| 生命周期 | 推送结果 | 检测点 |
|---|---|---|
| 有效订阅 | 送达 → lastSuccessAt 更新 | tests/notify-push.test.ts |
| 端点回 401/404/410 | 订阅删除并落盘 | tests/notify-push.test.ts |
| 端点回 5xx/网络错 | 保留订阅，其他订阅不受影响（allSettled） | tests/notify-push.test.ts |
| lastSuccessAt 距今 >90 天 | 24h 扫描时清除 | tests/notify-push.test.ts（fake timers） |
| 面板关开关 | 发出服务端 DELETE | tests/notify-panel.test.ts |

轴 3：通知点击 × 窗口状态（SW 源码单测，happy-dom 不派发真 push 事件，以 handler 存在性+可注入 self 的纯函数测试为准，iOS 真机走人工门）

| 状态 | 行为 | 检测点 |
|---|---|---|
| 已有 herdweb 窗口 | matchAll 命中并 focus，不开新窗 | tests/notify-*.test.ts 覆盖 SW 纯逻辑（抽出可测函数） |
| 无窗口 | openWindow(scope) 冷启动 | 同上 |
| pushsubscriptionchange | vapid-key fetch → 重订阅 → DELETE 旧 → POST 新 | 同上 |

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：`pnpm exec tsx cli.ts serve --port 7781 -- bash --norc` 起服务后：①`curl -X POST 127.0.0.1:7781/api/events -d '{"v":1,"id":"t1","kind":"test","title":"T","ts":1}'` 回 202；②`GET /sw.js` 200 且带 `Service-Worker-Allowed`；③`GET /api/push/vapid-key` 返回公钥；④CSP 响应头含 `worker-src 'self'`；⑤浏览器（chromium）打开页面 → 抽屉 🔔 → 面板可开、订阅开关可请求权限并 POST subscribe。
- **相关测试**：`pnpm test`（全量）；`pnpm run test:pw -- tests/playwright/notify.spec.ts`——E2E（chromium）：grant notifications 权限 → UI 订阅成功（服务端 push-subscriptions.json 出现该 endpoint）→ POST kind=test → SW 展示通知（经 `registration.getNotifications()` 断言）→ 合成派发 notificationclick → 已有窗口被 focus。验证命令写全量路径，禁抄子集过滤版。
- **概率性验收**：不适用（本卡无时序/并发重试逻辑；限流/去重为确定性状态机）。
- **接口契约**（卡 2/卡 3 消费，签名不写实现；卡 2/卡 3 会 import 这些符号，改签名=打穿下游卡）：

```typescript
// src/notify/events.ts
export const NOTIFY_KINDS = ['asking', 'done', 'ci-red', 'silence', 'health', 'test'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]
export interface NotifyEvent { v: 1; id: string; kind: NotifyKind; session?: string; title: string; body?: string; reason?: string; ts: number }
export function parseNotifyEvent(raw: string): NotifyEvent   // 抛 NotifyEventError（带 statusCode 400/413）
// src/notify/state.ts
export function resolveNotifyStateDir(port: number): string  // XDG_STATE_HOME 兜底 ~/.local/state/herdweb/{port}
export function readJsonFile<T>(path: string): T | undefined // 不存在=undefined
export function writeJsonFileAtomic(path: string, value: unknown, mode?: number): void
export function appendEventLine(stateDir: string, event: NotifyEvent, limit: number): void // test 不落盘+惰性截断
// src/notify/push.ts
export interface PushSubscriptionRecord { endpoint: string; keys: { p256dh: string; auth: string }; lastSuccessAt: number }
export function ensureVapidKeys(stateDir: string, override?: VapidConfig): { publicKey: string; privateKey: string; subject: string }
// src/notify/service.ts
export interface NotifyService {
  dispatchEvent(event: NotifyEvent): 'accepted' | 'duplicate'  // 去重+落盘+异步推送（内部车道也走这里）
  awaitInFlight(timeoutMs: number): Promise<void>              // 停机排空
  lastEventAt(session?: string): number | undefined            // 卡 2 静默让位判定用
}
export function createNotifyService(deps: NotifyServiceDeps): NotifyService
// src/notify/routes.ts
export function registerNotifyRoutes(app: Hono, deps: NotifyRouteDeps): void // events/push 两族端点集中在此，serve.ts 只调一次
```

- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist` 全绿（本地 check 的 `.omo/` 噪音按 HANDOFF 已知噪音豁免，报告原文贴出即可）。
- **截图或探活**：报告贴 curl 冒烟输出（上列 ①-⑤）与 `git show --stat` 。
- **现场还原**：执行器收工停在 delegate 分配的分支；不删 worktree；不回滚他人提交。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：按「notify schema+state → push+service → serve 路由+CSP+排空 → SW+client 注册 → 面板 UI → E2E」至少分 6 次 commit，每个里程碑测试同步落。
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

- **现场事实（主脑预取）**：base=fb1c6ec（main，工作区干净，无并行卡）。代码锚点（行号为该 commit 快照，以符号为准）：`buildSecurityHeaders` src/serve.ts:156（CSP 串 :168，消费方 tests/serve.test.ts 有快照断言）；`isLoopbackHost` src/serve.ts:179；`routeVariants` src/serve.ts:275 与 `registerImageDropRoutes` src/serve.ts:382（路由注册范式）；serve 退出序列约 src/serve.ts:661（PTY exit → server.close）；client-entry.ts 现无 SW 注册；config-schema.ts 为 Valibot strictObject 风格。真实取值域统计（kind 白名单）：`grep -rn "'silence'\|'health'\|'asking'" src/ tests/` 于 base 上零命中——六 kind 全是本卡新引入，无存量取值可撞。
- **机理/根因陈述**：无（新功能卡）。
- **已完成**：设计定稿（CEO+Eng review CLEAR，HANDOFF 自包含）。
- **未完成**：全部实现。
- **关键决策**：见锁定决策 4（鉴权边界拆分是对 HANDOFF「同鉴权」的工程化解读——回环限制若加到手机要打的订阅端点会把功能打死，已在卡面记录偏差）与 13（面板动作走 DI 不扩 union）。
- **已否决方案**：SW 带 fetch handler / Workbox（违反不变式）；skipWaiting（v1 不用）；token 嵌页面给订阅端点（等同没加，安全剧场）；`failed` kind（badge 证据体系不存在）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：iOS Safari 标签页无 Push API——必须主屏 PWA，已在面板做 display-mode 检测+引导；iOS 真机验证走人工门不进 CI。
- **下一步唯一动作**：按「完成条件」实现并在分支上提交。
