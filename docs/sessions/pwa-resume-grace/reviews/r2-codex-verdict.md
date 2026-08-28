# PWA 切后台宽限期与重连遮罩：R2 Codex 复验 verdict

审查对象固定为 `78a3056..47740bb`，代码证据均引用 `47740bb`；区间外提交不纳入本轮。仓库风险等级为 `personal`。本轮新证据是修复增量 `ea9d1b8..47740bb`、F-001/F-002/F-003 的修复锁死测试、首连完整握手的帧序列探针、probe 成功后的遮罩探针、跨两次 hidden 周期的宽限回调探针、hidden 中 probe deadline 探针，以及目标 SHA 上固定测试和全量测试结果。

## Findings

### R2-F-001 — P2：首次完整握手后的非持久化 pageshow 会额外发送 resume probe

- 严重度与两问：P2。真实手机页面加载中，WebSocket 首次完成 snapshot 且初始 heartbeat 已收到 pong 后，浏览器仍可能派发 `pageshow(persisted=false)`；但额外 ping 不写 PTY、不丢用户数据、不崩溃，只造成首连帧序列和网络时序偏离，因此不满足 personal P1 两问。
- 违反规格：首连正常握手（无 hidden 参与）与 base 行为完全一致；首连握手窗口不应追加 resume probe。
- 代码证据：`src/client-entry.ts:1167-1174` 在 `pageshow(false)`、socket OPEN、snapshot 已完成且新鲜时，以 `canResumeProbe(gracePending)` 放行；`src/client-entry.ts:1103-1109` 将 `snapshotLoaded` 作为 probe 证据。没有 hidden 参与时 `gracePending=false`，但 `snapshotLoaded=true` 仍可放行。
- 触发路径：首连 → targets/attach/snapshot/attach-committed → 初始 heartbeat pong → `pageshow(false)`；base `78a3056` 保持原 ping 帧序列，目标多发 1 个 `{"type":"ping","nonce":"..."}`。
- 修法方向：非持久化首次 `pageshow` 无 hidden grace 账本时保持 base 的返回路径；不要仅因 snapshot 已完成就把首次 pageshow 当作 resume probe 触发器。
- 取证：临时同一帧序列测试在 base `78a3056` 通过，在 `47740bb` 失败：`expected ... length of 1 but got 2`。

### R2-F-002 — P2：probe 期间的“未发送”提示在匹配 pong 后残留为可见横幅

- 严重度与两问：P2。真实用户可在恢复探活的 4 秒窗口内触发键盘输入，输入按契约丢弃并提示；匹配 pong 后连接已经回到 `synced`，但横幅仍覆盖终端顶部并继续显示旧提示。这是可见的错误状态和误导，不涉及数据清除、静默写入或崩溃，因此不满足 personal P1 两问。
- 违反规格：匹配 pong 后保持 `synced` 并恢复心跳；synced 状态的连接遮罩应隐藏，提示不能覆盖已恢复的连接状态。
- 代码证据：`src/client-entry.ts:332-334` 在 probe 在途时发出 `Not sent — still syncing.`；`src/client-entry.ts:808-820` 的匹配 pong 只清 deadline、清 in-flight、更新新鲜度并排下一次 heartbeat，不触发状态监听；`src/reconnect.ts:162-172` 的 `onNotice` 直接把 overlay 设为 `flex`；`src/reconnect.ts:145-158` 只有后续 `render(status)` 才按 `status.state === 'synced'` 设为 `none`。
- 触发路径：已 synced → hidden → visible 发 probe → probe 期间 input → `onNotice` 显示横幅 → 匹配 pong 保持同一个 `synced` 状态；没有状态变更再次调用 `render`，横幅永久保持可见，直到其他状态事件或重新挂载。
- 修法方向：匹配 pong 成功时清掉 transient notice 并驱动 synced 遮罩隐藏，或让 notice 显示路径服从当前 synced 状态；不要让一次已处理的丢弃提示绕过状态渲染。
- 取证：临时测试在目标上失败，原文为 `expected 'flex' to be 'none'`。

### R2-F-003 — P2：前一轮 hidden 的迟到宽限回调可越过下一轮 hidden 的 timer 世代

- 严重度与两问：P2。移动端后台节流下，第一次 hidden 的 timer 回调可能延迟到 visible、再次 hidden 后才执行；此时 `pageHidden` 仍为 true，旧回调会提前关闭当前仍在第二轮宽限期内的 socket。结果是可见断线/重连和提前失去复用，不清理 PTY 或终端数据，因此不满足 personal P1 两问。
- 违反规格：60 秒宽限不应叠加或被旧回调提前结束；旧生命周期事件必须被世代门禁忽略；宽限 timer 账本最多一个且只能由当前 timer 裁决。
- 代码证据：`src/client-entry.ts:1095-1100` 的回调无 timer 身份/世代检查，只把 `hiddenSuspendTimer` 置空，再以 `pageHidden` 判定并调用 `suspendConnection()`；`src/client-entry.ts:1134-1139` visible 会清旧 timer 并启动 probe，之后再次 hidden 可建立新 grace。
- 触发路径：hidden A 建立回调 A → visible 清 A、probe 成功 → hidden B 建立回调 B → 回调 A 延迟执行；`pageHidden=true` 使现有守卫通过，A 清掉 B 的账本并关闭当前 socket。
- 修法方向：回调执行前校验它仍是当前 `hiddenSuspendTimer` 对应的 timer/世代；旧回调只返回，不清除新 timer、不 suspend 当前 socket。
- 取证：临时两轮 hidden 测试在 `47740bb` 失败，原文为 `expected 3 to be 1`（socket CLOSED 而预期 OPEN）。这不是 R1 “visible 后迟到”路径的改写：本路径在旧回调执行时页面再次处于 hidden，现有 `pageHidden` 守卫反而放行。

## 审查视角

### 1. 回归与误拒方向

- synced 且新鲜的普通 input：通过。`src/client-entry.ts:327-341` 在 `synced + attachmentId + OPEN + fresh + 无 probe` 时直接走 `emitOnOpenSocket`；目标测试 `snapshot freshness permits immediate ordinary input` 通过，帧为一个带 attachmentId 的 input。
- 首连正常握手：不通过，见 R2-F-001。无 hidden 的 base/target 同一探针：base 保持 1 个初始 heartbeat ping，target 在已收到 pong 后的 `pageshow(false)` 变为 2 个 ping。
- probe 成功后的心跳：通过当前常规路径。`src/client-entry.ts:808-820` 清在途 ping 后只排一个 10 秒 heartbeat；目标固定测试三轮均通过，`visible cancels a late grace timer so a live socket stays up` 也连续消费匹配 pong 并观察到单循环。R2-F-002 是提示显示残留，不是 heartbeat 双循环。
- 曾 synced 后横幅的 Retry now / Re-authenticate / 点击重连：通过。`tests/reconnect.test.ts` 的 24 个测试通过；`src/reconnect.ts:80-83` 的 Retry now 和 `src/reconnect.ts:99-102` 的 Re-authenticate 仍分别转发重连与 reload，`src/reconnect.ts:104` 的横幅点击仍转发重连。
- `session ended` 提示：通过。`src/client-entry.ts:629-648` 先 `setConnectionStatus('disconnected')`，状态监听驱动 `render` 的布局/display，再派发 notice；`src/reconnect.ts:162-172` 只更新文本、隐藏认证按钮并保持 display。`tests/reconnect.test.ts:189-214` 验证 session-ended 文本、认证按钮隐藏、Retry now 保留。删除 `onNotice` 中冗余 `applyOverlayLayout` 不影响该路径，因为布局由先前的 `render` 驱动。

### 2. 修复面专项红验/绿验

每条注入前均用 `rg` 确认目标测试实际存在；F-002 使用 `995b99c` 中的原始锁死测试临时补回 base/target（该测试随后在 `47740bb` 被折叠删除）。

#### F-001：迟到 hidden-grace callback

```text
BASE ea9d1b8：1 failed，Tests 1 failed | 83 skipped (84)
失败原文：expected 3 to be 1（target socket 被关闭）
TARGET 47740bb：1 passed，Tests 1 passed | 83 skipped (84)
```

#### F-002：首连 pageshow 探活门禁

```text
BASE ea9d1b8：1 failed，Tests 1 failed | 83 skipped (84)
失败原文：expected [ { type: 'ping', nonce: 'ping-2' } ] to have a length of +0 but got 1
TARGET 47740bb：1 passed，Tests 1 passed | 83 skipped (84)
```

#### F-003：hidden 清理退避 timer

```text
BASE ea9d1b8：1 failed，Tests 1 failed | 83 skipped (84)
失败原文：expected 2 to be 1（hidden 后 timer 数仍多 1）
TARGET 47740bb：1 passed，Tests 1 passed | 83 skipped (84)
```

专项结论：三条登记修复的直接锁死测试均为 base 红、target 绿；R2-F-003 记录的是 F-001 的另一世代触发路径，直接修复测试的绿不能证明所有迟到回调已被身份门禁隔离。

### 3. 两条待交叉疑点

#### a) everSynced 是否可能被非当前 epoch 的 snapshot 提前置位

判定：否。

`src/client-entry.ts` 中 `setConnectionStatus` 调用点完整清单如下：

```text
388  setConnectionStatus('syncing')
642  setConnectionStatus('disconnected')
677  setConnectionStatus('reconnecting')
715  setConnectionStatus('disconnected', reason)
936  setConnectionStatus('disconnected', 'protocol-error')
1007 setConnectionStatus('disconnected')
1028 setConnectionStatus('reconnecting')
1036 setConnectionStatus('syncing')
```

没有 `setConnectionStatus('synced')` 调用。唯一生产 `synced` 事实是 `src/client-entry.ts:892-896` 的 `connectionStatus` 直接赋值，随后在 `918-920` 通知监听者。所有 server message 在 `src/client-entry.ts:823-833` 先检查 `myEpoch === currentEpoch`；`attach-committed` 还在 `883-888` 校验 request/attachment/target 身份。因此 `reconnect.ts:145-149` 通过 `status.state === 'synced'` 置 `everSynced` 时，来源是当前 epoch 且身份匹配的 attach commit，不存在非当前 epoch snapshot 生产 synced 的路径。

#### b) probe 在途再次 hidden 时，4 秒 deadline 是否会在 hidden 中 failConnection

判定：否。

链路为：`src/client-entry.ts:1128-1132` hidden → `beginHiddenSuspendGrace()` → `src/client-entry.ts:1091-1094` 的 `stopHeartbeat()` → `src/client-entry.ts:553-560` 清 `heartbeatDeadlineTimer`、`heartbeatNextTimer`、`heartbeatPingId` 和 `resumeProbeInFlight`。即使 deadline 回调已经排队，`src/client-entry.ts:1123-1125` 仍要求 `heartbeatPingId === nonce`；hidden 清理已将其置为 `null`，故回调不会执行 `failConnection`。临时测试“probe 在途再次 hidden，推进 4 秒”通过，socket 仍 OPEN、状态仍 synced。

### 4. 熵增与修复增量复查

- `ea9d1b8..47740bb` 仅改 4 个既有代码/测试文件，`+93/-26`；没有新增配置项、fallback、重试机制或防御式 catch。
- F-001/F-003 是局部 guard/清理修复；F-002 是 `canResumeProbe` 的参数化门禁；`applyOverlayLayout` 的 early return 和内联样式属于已登记的化简，不新增抽象消费者。
- `canResumeProbe(gracePending = hiddenSuspendTimer !== undefined)` 的默认值在生产调用点没有被隐式使用：`src/client-entry.ts:1138`、`1172`、`1177` 均显式传入调用前捕获的 `gracePending`。`onVisibilityChange` 在 `1136` 捕获后于 `1137` 清 timer；`onPageShow` 在 `1154` 顶部捕获后于各分支清 timer，再显式传入同一布尔值，捕获/清理顺序一致。
- 当前增量没有新增状态；全区间的 `hiddenSuspendTimer` 与 `resumeProbeInFlight` 是规格点名的宽限/在途账本，已有真实读取面。没有发现新的双路径或未经批准的状态镜像。R2-F-001/R2-F-002/R2-F-003 是行为缺口，不以熵增 finding 重复计数。

## 验证命令与原文

### OCR 前置扫描

`ocr-review` 可执行，但在有界约 150 秒窗口内没有返回 JSON envelope；按规则不记为 clean。保留的原始输出摘要：

```text
OCR failover progress: leg=primary event=start
OCR failover progress: leg=primary elapsed_s=131.520
OCR 本地复核：KILL 后直接子进程仍未在 T_kill 内被 waitpid 回收，pid=1392062, /proc/1392062/stat state=Z
OCR 本地复核：KILL 后直接子进程仍未在 T_kill 内被 waitpid 回收，pid=1392063, /proc/1392063/stat state=Z
Traceback ...
KeyboardInterrupt
```

状态：未完成扫描，不代表扫过且干净；无活动 OCR 进程残留。

### 固定测试：连续 3 次

在全新、未注入的 `47740bb` 临时 worktree 执行：
`CI=true pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`

```text
=== RUN 1 ===
✓ |dom| tests/reconnect.test.ts (24 tests)
✓ |dom| tests/client-connection.test.ts (83 tests)
Test Files  2 passed (2)
Tests  107 passed (107)

=== RUN 2 ===
✓ |dom| tests/reconnect.test.ts (24 tests)
✓ |dom| tests/client-connection.test.ts (83 tests)
Test Files  2 passed (2)
Tests  107 passed (107)

=== RUN 3 ===
✓ |dom| tests/reconnect.test.ts (24 tests)
✓ |dom| tests/client-connection.test.ts (83 tests)
Test Files  2 passed (2)
Tests  107 passed (107)
```

### 全量测试：1 次

在同一未注入 `47740bb` 临时 worktree 执行 `CI=true pnpm test`（脚本实际运行 `vitest run`）：

```text
Test Files  74 passed (74)
Tests  1202 passed (1202)
Duration  12.95s
```

全量测试中的既有 stderr 为测试主动覆盖的 storage/动作失败日志，命令退出码为 0；不属于本审查区间 finding。

### 现场

- `git diff --check 78a3056..47740bb`：通过。
- 临时 worktree 已删除；`orphan-doctor` 未发现疑似孤儿进程。
- 远端 `card/herdweb-20260828-17` 已不存在，故 `git fetch origin card/herdweb-20260828-16 card/herdweb-20260828-17` 返回 `fatal: couldn't find remote ref card/herdweb-20260828-17`；R1 SHA `09a52a2` 在本地分支可读，目标 `origin/card/herdweb-20260828-16` 已确认指向 `47740bb`。不改变冻结审查对象。

## Final verdict

`pass`

本轮发现 3 条新增 P2，无满足 personal P1 两问的 finding；按 review 规则 P2 不阻塞本轮 verdict。修复专项直接锁死测试均 base 红/target 绿，固定两文件测试三轮和全量测试均通过。R2 结束后应将 R2-F-001、R2-F-002、R2-F-003 作为后续 P2 backlog 处理；本 verdict 不代表这些 P2 已修复。
