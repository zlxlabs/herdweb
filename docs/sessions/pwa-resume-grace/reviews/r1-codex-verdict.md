# PWA 切后台宽限期与重连遮罩：R1 Codex 审查

审查对象固定为 `78a3056..ea9d1b8`，代码证据均引用 `ea9d1b8`；区间外提交不纳入本轮。仓库风险等级为 `personal`，本轮按状态机例外采用“连续 2 轮无新增 P1”收敛条件。

## Findings

### F-001 — P2：迟到的 hidden 宽限回调可以在前台探活后关闭新鲜连接且不安排重连

- severity：P2。个人手机 PWA 在安卓后台节流/恢复时可触发；后果是可见的 `Disconnected`/重连横幅并保留手动重试，草稿与终端内容未被清除，因此不满足 personal P1 的数据丢失或静默错误两问。
- 违反规格：规格 1 的“到期才 suspend”边界、规格 2 的探活裁决前不关闭 socket，以及不变式“探活裁决出结果前零不可逆动作”“宽限 timer ≤1”。
- 代码证据：`src/client-entry.ts:1091-1097` 的回调无 token、epoch、`pageHidden` 或 socket 身份检查，直接调用 `suspendConnection()`；`src/client-entry.ts:1132-1138` 在 visible 时先清宽限 timer 再发送 resume probe；`src/client-entry.ts:1006-1012` 的 `suspendConnection()` 将状态设为 disconnected、递增 epoch、关闭 socket，但不调用 `scheduleReconnect()`。
- 触发路径：已 synced → `visibilitychange=hidden`，60 秒 timer 到期但浏览器暂缓派发；恢复前台先派发 visible，`clearHiddenSuspendGrace()` 后发送探活 ping；随后已入队的旧 timer 回调仍执行，调用 `suspendConnection()`，关闭探活 socket。由于 epoch 已失效且 suspend 路径不排新的重连 timer，页面停在 disconnected，直到用户点击 Retry now。相同竞态也可发生在 bfcache 的 pagehide/pageshow 后新连接上。
- 建议修法方向：宽限回调捕获并校验唯一 timer token/epoch、仍处于 hidden 且 socket 未被替换；取消或过期的回调必须只返回，不能执行 suspend。

### F-002 — P2：首次加载的非持久化 pageshow 额外发送 resume probe

- severity：P2。目标路径在 WebKit 注释所述的“首次加载时 socket 已 OPEN 但 snapshot 尚未到达”窗口可触发；额外 ping 不会写 PTY 或丢数据，但改变了首次加载协议流量并让首次连接进入 4 秒 probe 账本。
- 违反规格：不变式“首次加载路径行为与改动前完全一致”；resume probe 的适用条件是 visible 且 hidden grace 未到期，而非首次 `pageshow(persisted=false)`。
- 代码证据：`src/client-entry.ts:1147-1173` 在 `!persisted` 分支对任意 OPEN socket 检查 `!snapshotLoaded`，随后 `canResumeProbe()` 成功就调用 `sendResumeProbe(currentEpoch)`；实际发送及设置在途标记位于 `src/client-entry.ts:1108-1121`。
- 触发路径：首次加载 → socket `open` → `attach-started` 已收到、snapshot 尚未收到 → 浏览器派发 `pageshow(persisted=false)` → `snapshotLoaded=false`，代码发送 `{"type":"ping","nonce":"..."}`。临时在目标测试的原有断言后加入“ping 数不得增加”后，原测试变红：`expected [ { type: 'ping', nonce: 'ping-2' } ] to have a length of +0 but got 1`。
- 建议修法方向：非持久化首次 pageshow 仅保留既有握手/新鲜度判断；只有本次 visibility hidden 建立且尚未失效的 grace 账本才允许走 resume probe。

### F-003 — P2：进入 hidden 时没有清理已经存在的退避重连 timer

- severity：P2。个人 PWA 在已断线并等待退避时切后台可触发；实际 `connect()` 会因 `pageHidden` 返回，用户通常还能在 visible 时立即恢复，故主要是违反计时器语义和后台唤醒，不是 P1。
- 违反规格：规格 1 的 hidden 生命周期要求，以及不变式“心跳与重连定时器在 hidden 期间不运行”。
- 代码证据：`src/client-entry.ts:671-681` 创建 `reconnectTimer`，其回调直接执行 `connect()`；`src/client-entry.ts:1091-1097` 的 `beginHiddenSuspendGrace()` 只调用 `stopHeartbeat()`，没有清除 `reconnectTimer`；`src/client-entry.ts:1014-1016` 虽会在 hidden 时让 `connect()` 返回，但 timer 已经运行。
- 触发路径：synced socket close → `scheduleReconnect()` 建立 1 秒退避 timer → 立刻 hidden → grace 开始但旧退避 timer 保留 → 到期回调在 hidden 中运行并调用 `connect()`，再因 `pageHidden` 返回。随后 visible 才重新尝试。该路径没有产生第二个 socket，但违反后台不运行重连 timer 的账本。
- 建议修法方向：hidden 入口清除现有 reconnect timer，并由 visible/恢复事件统一发起一次立即尝试。

### F-004 — P3：新增的单消费者包装层与“共享”样式常量增加无必要熵

- severity：P3。无法直接溯源到用户行为契约，按评审规则降级；不阻塞合并。
- 违反规则：REFACTOR-guide 的“多余路径/层”和“投机通用性”坏味道。
- 代码证据：`src/client-entry.ts:312-325` 的 `emitOnOpenSocket()` 在生产代码中只有 `src/client-entry.ts:339` 一个调用方，而 `sendInputAction()` 在 `src/client-entry.ts:366-373` 保留了相似的 framing/bufferedAmount 发送路径；`src/reconnect.ts:12-22` 的 `SHARED_OVERLAY_STYLE` 仅在 `src/reconnect.ts:57` 被消费，并没有第二个消费者。
- 触发路径：后续维护者需要同时理解单消费者 helper 与另一条重复发送路径；“SHARED”命名暗示已有共享边界，但实际没有共享。
- 建议修法方向：将单调用者 helper/常量内联，或等第二个真实消费者出现且能消除重复路径时再抽取；不要为 P2 修复新增抽象。

## 降层三问

### ① 探活裁决出结果之前的不可逆动作

- `visibilitychange=hidden`：`stopHeartbeat()` 清除 heartbeat deadline/next timer、清空 nonce/探活标志；这是可逆的状态账本写入。创建宽限 timer，不 reset 终端、不发 input、不关闭 socket，可接受。
- `visible` 触发探活：`sendResumeProbe()` 在 `src/client-entry.ts:1115-1121` 发送一帧带 nonce 的 ping，并写入在途 nonce/flag、创建 4 秒 deadline。这是契约明确允许的链路探测，不是 PTY 指令，也不等同于不可逆用户动作，可接受。
- 探活期间服务端 output：`handleOutput()` 在 `src/client-entry.ts:791-805` 仍可调用 `writeTerm()`；测试也明确锁定同 epoch output 可以写屏。它不 reset、不发 input，可接受。
- 正常匹配 pong：`handlePong()` 在 `src/client-entry.ts:808-820` 清 deadline、更新 `lastProvenFreshAt`，并恢复普通 heartbeat；这是探活成功后的可逆状态迁移，可接受。
- 不可接受分支是 F-001：迟到宽限回调在 pong 尚未裁决时进入 `suspendConnection()`，执行 close，并使后续 pong 失效。

### ② 守卫值在真实部署形态下是否成立

- `currentEpoch` 是当前页面模块内的单调值，能隔离同一页面中新旧 WebSocket 的事件；进程被杀后新文档从 epoch 0 启动，不会跨进程复用旧值，这符合本地页面边界。
- `heartbeatPingId` 与 `resumeProbeInFlight` 能区分同一单在途 ping 通道的 nonce 与“探活中”输入门禁；hidden、freeze、pagehide、offline 会通过 `stopHeartbeat()` 清理它们。快速 hidden/visible 抖动在 timer 回调尚未排队时只保留一个 timer/一个 probe。
- `hiddenSuspendTimer !== undefined` 能防止第二次 hidden 叠加 timer，也能在正常事件循环中被 visible/freeze 清掉；但 timer ID 不是取消后回调的世代守卫。安卓后台节流、到期回调延迟到恢复后执行时，F-001 的语义失效。
- bfcache 正常顺序（先 pagehide 再 pageshow）会由 pagehide 立即 suspend，pageshow 仅排一次新连接；若旧 grace 回调已入队，它仍可能越过 clear 操作关闭恢复后的新 socket，仍属于 F-001 的 stale callback 变体。

### ③ 门禁保护状态写入还是实际行为

- WebSocket 的 open/close/error/message 入口在 `src/client-entry.ts:1034-1047` 和 `src/client-entry.ts:823-833` 先做 epoch 门禁，覆盖了状态写入、写屏和普通 close/error 处理；snapshot 的 reset 在 `src/client-entry.ts:746-760` 之后才执行 epoch/attachment 检查，写回 `snapshot-applied` 的 drain callback 在 `src/client-entry.ts:770-783` 再次检查，覆盖较完整。
- `sendResumeProbe()` 在 `src/client-entry.ts:1108-1113` 发送前检查 epoch、socket OPEN，并由调用方保证 visible；但它没有自己的 `pageHidden`/timer 世代门禁。`onPageShow(persisted=true)` 也可在 probe 已排队时强制进入 `queueImmediateConnect(true)`，保护的是“只排一个立即尝试”，不是“探活未裁决前不 close”。正常 bfcache pagehide 会先置 socket null，临时竞态仍应由实际行为门禁收口。
- F-001 是只保护了 `hiddenSuspendTimer` 变量的“是否有 ID”，没有保护定时器回调实际执行 `suspendConnection()`/`socket.close()` 的缺口。
- `send()`/`sendInputAction()` 在入口以 synced、OPEN、probe flag 门控，且单线程同步执行期间没有可插入的 JS 事件；resize 例外实际发送。新增 `emitOnOpenSocket()` 本身没有独立门禁，仍依赖调用方，亦是 F-004 的单消费者层问题。

## 事件交错推演

| 序列 | `ea9d1b8` 行为 | 判定 |
|---|---|---|
| hidden → visible → hidden → visible，<1s 两轮 | 第一次 hidden 建 grace A；第一次 visible 清 A、发 nonce-1 probe；第二次 hidden 清 probe deadline/nonce/flag、建 grace B；第二次 visible 清 B、发 nonce-2。迟到 nonce-1 因 nonce 不匹配被丢弃。 | 正常未迟到时满足 ≤1；若 A/B 的回调已入队则受 F-001 影响。 |
| hidden → 探活在途 → 再 hidden | 第二个 hidden 调 `stopHeartbeat()`，取消 probe deadline 并清 in-flight 标志，不 close；再 visible 重新发 nonce。旧 pong 不匹配。 | 通过。 |
| 探活在途收到 exit | `handleServerMessage()` 先过当前 epoch，`enterTargetEnded()` 清 heartbeat/probe、置 `exitReceived`、断开状态并发 session-ended notice；迟到 pong 因 nonce 已清被丢弃。 | 通过，且不自动重连符合 exit 语义。 |
| 探活在途时宽限 timer 迟到触发 | visible 已清 timer 并发 probe，但已进入队列的回调仍执行 `hiddenSuspendTimer=undefined; suspendConnection()`；关闭 socket、递增 epoch、无 reconnect timer。 | F-001。 |
| probe deadline 与匹配 pong 同一宏任务 | pong 先执行：清 nonce/deadline，随后 timeout 的 nonce 比较失败；timeout 先执行：`failConnection()` 递增 epoch/清 nonce，随后旧 socket pong 在入口被 epoch 忽略。 | 两种先后均不误续命；通过。 |
| hidden 期间收到大量 output 再 visible | snapshot 已加载时 output 直接走 `writeTerm()`，不 reset；普通 heartbeat 已停。visible 先发 probe，匹配 pong 保持旧屏；若渲染 backlog/输出超限则现有 failConnection 关闭并等待 visible 重连。 | 通过；输出写屏是契约允许的实际行为。 |
| `pageshow(persisted=true)` 与 `visibilitychange visible` 同帧 | 正常 bfcache 先 pagehide：socket 已为 null，pageshow 和 visible 都只排同一个 microtask，建立一个新 epoch；无探活。若脱离正常 pagehide 单独先 visible 发 probe，再 persisted pageshow 强制排 connect，则可能关闭 probe，但该变体与 F-001 同属缺少行为门禁。 | 标准顺序通过；非标准事件交错暴露同一 stale/force-close 风险。 |

## 红验抽查

注入前先用 `git diff` 确认基线只被拷入目标测试文件；临时 worktree 为 `/tmp/herdweb-pwa-r1-base.joQYdJ` 与 `/tmp/herdweb-pwa-r1-target.dnQnCm`，不属于仓库产物。

抽查 A：探活行为，`tests/client-connection.test.ts`（目标新增的 `resume probe in flight drops keyboard input without failConnection` 等整文件）。

```text
BASE: Test Files  1 failed (1)
BASE: Tests 12 failed | 70 passed (82)
BASE: 失败包括 hidden grace、probe 输入丢弃、probe deadline 等目标新增断言。
TARGET: Test Files  1 passed (1)
TARGET: Tests 82 passed (82)
```

抽查 B：横幅布局，`tests/reconnect.test.ts`（目标新增的 modal/banner 样式与点击行为）。

```text
BASE: Test Files  1 failed (1)
BASE: Tests 11 failed | 12 passed (23)
BASE: 失败原文示例：expected undefined to be 'modal'；expected undefined to be 'banner'
TARGET: Test Files  1 passed (1)
TARGET: Tests 23 passed (23)
```

首次加载探针（临时测试，非仓库产物）在目标提交上将“ping 数保持不变”作为额外断言，原文失败为：

```text
AssertionError: expected [ { type: 'ping', nonce: 'ping-2' } ] to have a length of +0 but got 1
```

迟到 timer 探针（临时测试，预期是捕获缺陷）保存宽限回调后执行 `hidden → visible → callback`，目标提交原文结果为：

```text
Test Files  1 passed (1)
Tests 1 passed | 82 skipped (83)
```

该“passed”表示探针成功观察到 socket 被关闭、状态变为 disconnected、且没有新增 socket，不表示实现符合契约。

## 验证命令

固定命令：`pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`

```text
=== RUN 1 ===
✓ |dom| tests/reconnect.test.ts (23 tests) 83ms
✓ |dom| tests/client-connection.test.ts (82 tests) 126ms
Test Files  2 passed (2)
Tests  105 passed (105)

=== RUN 2 ===
✓ |dom| tests/reconnect.test.ts (23 tests) 80ms
✓ |dom| tests/client-connection.test.ts (82 tests) 127ms
Test Files  2 passed (2)
Tests  105 passed (105)

=== RUN 3 ===
✓ |dom| tests/reconnect.test.ts (23 tests) 86ms
✓ |dom| tests/client-connection.test.ts (82 tests) 130ms
Test Files  2 passed (2)
Tests  105 passed (105)
```

OCR 前置扫描：`ocr-review` 可执行，但主腿约 90 秒未返回 JSON envelope；按 `review-discipline` 有界规则中止，输出为 `OCR 本地复核：KILL ... state=Z`，随后 `KeyboardInterrupt`。本轮将其记为“未完成扫描”，不记为 clean；无残留活动 OCR 进程。

## 熵增审查结论

| 新增项 | 结论 |
|---|---|
| `HIDDEN_SUSPEND_GRACE_MS`、`RESUME_PROBE_DEADLINE_MS` | 规格明确要求的模块常量，保留。 |
| `hiddenSuspendTimer`、`resumeProbeInFlight` | 规格明确点名的 timer/探活账本；前者的 stale callback 另见 F-001，概念本身保留。后者用于区分复用心跳通道中的 probe 并门控输入，有真实第二个读取面。 |
| `freshnessIsStale()`、`showNotSentNotice()` | 分别有多个生产调用方；不是单消费者抽象。 |
| `clearHiddenSuspendGrace()`、`canResumeProbe()`、`sendResumeProbe()` | 多个生命周期调用方或必要的语义边界；保留。 |
| `applyOverlayLayout()` | `render()` 与 notice 事件两个调用方；保留。 |
| `emitOnOpenSocket()` | 单生产调用方且另有重复发送逻辑，命中“多余路径/层”，见 F-004。 |
| `SHARED_OVERLAY_STYLE` | 仅一个消费者，命中“投机通用性”，见 F-004。 |
| `everSynced` | 直接表达本次页面生命周期是否曾同步，是 modal/banner 契约所需事实，不是镜像状态。 |
| 测试侧 `hidePage()`、`showPage()`、`parseSent()`、`lastPing()` | 被多个新增测试复用，且直接断言实际序列化帧，保留。 |

## 存量 backlog

- `src/controls/mic-controller.ts`、`src/controls/image-drop-controller.ts` 消费 `isConnected()`/`onConnectionChange()` 的 synced 语义；该语义在本审查对象之前已存在，本轮只做引用扫描与现有测试复核，不登记为本 diff finding。
- `tests/client-targets.test.ts` 将既有“hidden”夹具改为 `freeze`，新增连接测试已覆盖 hidden grace；未发现区间内额外存量回归。
- `pnpm` 在临时 worktree 首次执行时自动补齐依赖；目标测试本身成功，属于临时现场，不写入仓库。

## 最终 verdict

`pass`

理由：本轮没有满足 personal P1 两问的 finding；F-001、F-002、F-003 为可见错误/契约偏差或后台 timer 语义问题，F-004 为非契约熵增，均按规则不阻塞本轮。P2/P3 应进入后续修复 backlog；本轮审查工作、固定区间取证、红验、交错推演和三次时序验证均已完成。
