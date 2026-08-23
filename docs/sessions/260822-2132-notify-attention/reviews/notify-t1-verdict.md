# notify-t1 推送管道独立审查 R1 · verdict

## 审查元数据

| 项 | 值 |
|---|---|
| 审查范围（冻结 H0） | `fb1c6ec728e842e75f853e38e2eb078168ff8889..c188960f28a9e813d3d2c2c36af8c2d1224b3adf` |
| 审查人 | delegate 派发独立审查（Cursor） |
| 风险等级 | infra 例外（personal → 连续 2 轮无新增 P1 收敛） |
| Spec | `docs/sessions/260822-2132-notify-attention/HANDOFF.md` 不变式节 + `docs/sessions/cards/notify-t1-push-pipeline.md`（73c3378，审查对象树未含该文件，以 HANDOFF+卡面锁定决策为准） |
| OCR 前置 | status=`reviewed`，59 条；本审查逐条独立核实，不照搬 OCR 理由 |
| 本轮新证据 | ① Node 24 `unhandledRejection` 探针（fire-and-forget push promise）；② c188960 临时 worktree 跑 `tests/notify-push.test.ts` 9/9 绿；③ `scripts/p1-push-rejection-demo.mts` 实证 `unhandledRejection: true` |

## 预登记候选逐条核实

| # | 候选 | 结论 | 理由 |
|---|---|---|---|
| P1 | `service.ts` `dispatchEvent` 的 `pushToAll` promise 无 catch，`ensureVapid`/`writeSubscriptions` 抛错 → 未处理 rejection 可致死 serve | **采信 → P1** | `pushPromise = pushToAll(...).finally(...)` 无 `.catch`；`dispatchEvent` 不 await。演示：`stateDir` 只读后 `dispatchEvent(test)` → `unhandledRejection: true`。违反 HANDOFF「服务自身异常不再是盲区」、infra 红线「推送故障传播给终端会话」、卡面锁定决策 5（推送隔离不应拖垮进程） |
| P2① | `state.ts` `writeJsonFileAtomic` rename 后「重读+重写全文」chmod 冗余且 TOCTOU | **采信 → P2** | tmp 已带 `mode`，rename 保留 mode；`readFileSync+writeFileSync` 整文件重写引入并发覆盖窗。违反卡面锁定决策 7（原子写纪律） |
| P2② | 面板 subscribe POST 失败时 fetch 抛错无本地回滚 | **采信 → P2** | `subscribe()` 仅 `!response.ok` 时 `unsubscribe`；`fetchFn` 抛错则本地 `PushSubscription` 孤儿。违反卡面锁定决策 13（订阅开关=服务端登记一致）、HANDOFF「关订阅=服务端 DELETE」对称性 |
| P2③ | `navigator.serviceWorker.ready` 无超时，SW 安装失败面板永久挂起 | **采信 → P2** | `getRegistration()` 无限 await `ready`；`open()` 后 `refreshToggle`/`subscribe` 可永久 pending。违反卡面锁定决策 13 fail-safe、10（SW 故障不得破坏核心控件——挂起也属于失控） |
| P2④ | `Notification` API 无存在性守卫 | **不采信 → P3 backlog** | 卡面/HANDOFF 硬约束平台为 Android Chrome + iOS 16.4+ 主屏 PWA；旧 WebView 属明确 non-goal。可在目标平台加守卫作 UX 加分，非 P2 |

## Findings

### P1（必修）

#### F-P1-1 · 异步推送 rejection 未兜底可拖垮 serve 进程

- **证据**：`src/notify/service.ts:168-172`（`pushToAll(...).finally` 无 catch）；`pushToAll` 内 `ensureVapid()`（`:80`）、`writeSubscriptions`（`:130`）均可同步抛错
- **违反 spec**：HANDOFF 不变式「服务自身异常不再是盲区」；卡面锁定决策 5（逐订阅 allSettled 隔离≠进程级隔离）；infra 红线「推送故障传播给终端会话」
- **P1 两问**：① 状态目录权限异常、磁盘满、atomic write 失败等真实运维场景会触发；② 未处理 rejection 在 Node 22+ 可终止进程，PTY 会话陪葬
- **验证**（c188960 worktree）：
  ```text
  $ pnpm exec tsx scripts/p1-push-rejection-demo.mts
  unhandledRejection: true
  ```

### P2（建议修；本轮可记 backlog 但不阻塞 infra 收敛需先清 P1）

#### F-P2-1 · `writeJsonFileAtomic` chmod 实现冗余且扩大 TOCTOU

- **证据**：`src/notify/state.ts:48-55`
- **违反 spec**：卡面锁定决策 7（tmp+rename 原子写）；HANDOFF 不变式 config/state 分工（runtime truth 文件完整性）
- **修复（减法）**：删 read+write 块，改 `chmodSync(path, mode)` 或依赖 tmp `mode`（rename 已保留）

#### F-P2-2 · 订阅 POST 网络异常导致客户端孤儿订阅

- **证据**：`src/controls/notify-panel.ts:117-134`（POST 无 try/catch）；对比 `:132-134` 仅处理非 2xx
- **违反 spec**：卡面锁定决策 13；HANDOFF「关订阅=服务端 DELETE」（登记对称）
- **修复（减法）**：POST 包 try/catch，失败时 `subscription.unsubscribe()` + 复位 toggle

#### F-P2-3 · Service Worker `ready` 无超时，面板可永久挂起

- **证据**：`src/controls/notify-panel.ts:70-77`；调用链 `open()` → `refreshToggle()`、`subscribe()`
- **违反 spec**：卡面锁定决策 13 fail-safe、10（SW 注册失败静默降级——挂起不算降级）
- **修复（减法）**：`getRegistration()` 用 `getRegistration()` + `Promise.race(ready, timeout)` 降级文案

#### F-P2-4 · `pushsubscriptionchange` 重订阅 POST 失败无回滚

- **证据**：`src/sw-entry.ts:68-78`（POST subscribe await 无 ok/throw 处理；前序 DELETE 已 `.catch` 吞掉）
- **违反 spec**：卡面锁定决策 8（pushsubscriptionchange：DELETE 旧 + POST 新）；HANDOFF SW handler 全集
- **修复（减法）**：POST 非 ok 时 `subscription.unsubscribe()` 并 throw 让 `waitUntil` 记录失败

#### F-P2-5 · PTY 退出路径未 `session.dispose()`，与 SIGINT 清理不对称

- **证据**：`src/serve.ts` PTY exit 路径 `:722-727` 无 `await session?.dispose()`；对比 SIGINT `cleanup` `:706-712` 有 dispose
- **违反 spec**：卡面锁定决策 11（停机排空框架完整性）；HANDOFF 停机顺序（卡 1 框架，卡 2 补 last-session）
- **修复（减法）**：PTY exit 路径对齐 `cleanup` 序列

#### F-P2-6 · `writeSubscriptions` 并发调用无序列化

- **证据**：`src/notify/service.ts:130`（push 后写）、`:141-147`（24h prune 定时器）、`routes.ts:164`（subscribe 路由）均为 read-modify-write
- **违反 spec**：卡面锁定决策 5（订阅数组一致性）；锁定决策 7 原子写仅保证单写原子，不防并发双写丢更新
- **修复**：优先减法——prune 在 `inFlight.size > 0` 时跳过；或单 writer 队列（仅当减法不够）

#### F-P2-7 · `trimEventsFile` 全文件重写与 O_APPEND 并发可丢事件

- **证据**：`src/notify/state.ts:58-66` 同步 read+rewrite；`appendEventLine` `:73-74` 同路径内联 trim
- **违反 spec**：卡面锁定决策 7（events.jsonl O_APPEND + 惰性截断）；HANDOFF 事件落盘不变式
- **触发**：超 2×limit 边界 + 并发 POST（低概率 personal 部署）；记 P2 非 P1
- **修复（减法）**：trim 延后 `setImmediate`；或持 fd 截断

### P3 / backlog（可接受不修）

| ID | 摘要 | 证据 | 备注 |
|---|---|---|---|
| F-P3-1 | `Notification` 未守卫 | `notify-panel.ts:99` | 目标平台外；见预登记④ |
| F-P3-2 | base64 编解码在 panel 与 SW 重复 | `notify-panel.ts:16-35`, `sw-entry.ts:81-100` | 第二消费者已存在；抽共享模块为可选减法 |
| F-P3-3 | `mountNotifyStack` 转发层 | `serve.ts:410-452` | 单挂载点；可内联 |
| F-P3-4 | `notify-panel` 扩 union 而非纯 DI | `config-schema.ts`, `types.ts` | 主脑验收已记偏差；功能正确 |
| F-P3-5 | `awaitInFlight` 单次快照不循环至空 | `service.ts:175-182` | 10s 上限为卡面明示；shutdown 边界可接受 |
| F-P3-6 | 测试按钮 fetch 无 try/catch | `notify-panel.ts:187-205` | 仅 UI 状态；非进程级 |
| F-P3-7 | 样式/组织类 OCR 余项 | `styles/base.css` 等 | 熵增 ≤P3 |

## 熵增审查（新增抽象/文件/状态）

| 新增项 | 第二消费者 / 必要性 | 结论 |
|---|---|---|
| `src/notify/{events,state,push,service,routes,rate-limit}.ts` | 卡 2/3 契约 + serve 挂载 | 必要 |
| `src/controls/notify-panel.ts` | drawer 动作 + E2E | 必要 |
| `src/sw-entry.ts` + build 双路径 | SW 路由 + 单测纯函数 | 必要（卡面锁定决策 8） |
| `mountNotifyStack` | 仅 `serve()` 一处 | ≤P3，可内联 |
| `deny`/`requireOrigin` helpers | 仅 `routes.ts` | ≤P3 |
| `DedupStore` class | 仅 `service.ts` | 必要（去重不变式） |
| `notify-panel` action union 成员 | registry + schema | 记录偏差；非阻塞 |
| `export { routeVariants }` | 测试可 import（实际测试本地重复） | ≤P3 |

**熵增结论**：核心模块有下游卡消费；转发层与重复编解码可减法，无新增 P1 级抽象。

## 测试与只读验证

| 命令 | 结果 |
|---|---|
| `pnpm test tests/notify-push.test.ts`（c188960 worktree） | 9 passed |
| P1 演示 `tsx scripts/p1-push-rejection-demo.mts` | `unhandledRejection: true` |
| 主脑预跑（本审查未重跑全量） | `pnpm test` 849（1 负载偶发已知噪音）、tsc、build:dist、check、test:pw chromium 绿 |

## 建议修复清单（优先减法）

1. **P1**：`pushToAll(...).catch(err => console.error(...))` 或等效 fail-loud sink——禁止裸 fire-and-forget rejection（`service.ts:168`）
2. **P2**：删 `writeJsonFileAtomic` 重读重写 chmod（`state.ts:50-54`）
3. **P2**：面板 subscribe POST 包 try/catch + unsubscribe 回滚（`notify-panel.ts:121`）
4. **P2**：`getRegistration` 加超时降级（`notify-panel.ts:70-77`）
5. **P2**：SW `pushsubscriptionchange` POST 失败处理（`sw-entry.ts:68-78`）
6. **P2**：PTY exit 补 `await session?.dispose()`（`serve.ts:722-727`）
7. **P2**：prune 与 push 写订阅互斥或单 writer（`service.ts:141-147`）
8. **backlog**：trim 异步化、base64 共享、union→纯 DI

## 最终 verdict

**fail** — 存在未解决 P1（F-P1-1）。infra 例外收敛条件「连续 2 轮无新增 P1」未满足；须先派修复卡清 P1 后再开 R2。
