# PR #119：iOS PWA 麦克风常驻采集 R1 独立评审

- 审查对象（H0 冻结）：`3254576ce512af18cd46cf274ad37f9f41ffd98e..61cc8134c8b26b1746db70147954984eb85556c8`
- 提交：`f5259d0` feat keep-alive → `2c6c130` 轴表测试 → `61cc813` dispose 不进 PcmCapture 接口
- Diff：4 files，+374/−53（`src/asr/doubao/engine.ts`、`src/controls/mic-controller.ts`、`tests/asr-engine.test.ts`、`AGENTS.md`）
- 结论：**fail**
- Findings 计数：**P1 1、P2 3、P3 1**

## 本轮新证据（开启审查前写明）

本轮结论依赖下列**本轮新获得**的证据，不是同一份 diff 的再次阅读：

1. 在 H0（`61cc813`）工作树上实测：
   - `pnpm exec vitest run tests/asr-engine.test.ts` → 40/40 通过（含 keep-alive 5 条）
   - `env -u FORCE_COLOR pnpm test` → 73 files / 1158 tests 通过
   （第一次带 `FORCE_COLOR` 的 `pnpm test` 因 CLI stderr 断言被 Node 颜色警告污染红了 1 条，与本 diff 无关；去掉该环境变量后全绿。）
2. 对 `BrowserPcmCapture` 的 stop / pause（keep-alive 的 stop 分支）/ resume（`restartHeldCapture`）/ release 四条路径的代码走读，并对照 base `3254576` 的旧 `stop()`。
3. `/tmp/keepalive-r1-probe.mjs`（仓外探针，`pnpm exec tsx`，不改仓库）：keep-alive 二次 start 在 `AudioContext.state === 'interrupted'` 时 `resumeCallsDelta = 0` 且状态仍为 `interrupted`，却仍新建 worklet（`nodeCount = 2`）；`pagehide` 打在 in-flight `getUserMedia` 上时 `engine.start()` 成功返回、`contextCount = 0` / `nodeCount = 0`、下一次 `start()` 抛 `ASR engine is busy`。
4. OCR 前置：`ocr-review` 对 `3254576..61cc813` 返回 `status=reviewed`（minimax / MiniMax-M3），11 条 finding 的 verifier 全部 `unverified`。下面只采纳经本轮走读/探针核实的条目，不照抄 OCR 严重度。

## OCR 前置对照

| OCR 标注 | 本仓判定 | 两问 | 处置 |
|---|---|---|---|
| mic-controller if/else 罗嗦（low） | 非缺陷 | — | 不采纳 |
| controller.dispose fire-and-forget（medium） | P3 | 真实触发偏卸载路径；不构成静默错结果 | P3-1 |
| 注入 engine 的 dispose 不对称（low） | 非缺陷 | — | 不采纳 |
| release 与 start 并发 double-close（high） | 不成立 | 单线程下 `releaseHeldResources` 先同步清空字段再 await | 反驳 |
| hasReusableCapture 未要求 source/node 已拆（high） | 不成立为 bug | `start()` 先 await `stopPromise`，finally 已拆图 | 反驳 |
| 未检查 `track.muted`（high） | 并入 P1-1 | iOS PWA 后台 mute 是已记录的真实现象 | 见 P1-1 |
| `context.suspend()` reject / 未处理 interrupted（high） | 并入 P1-1（interrupted）；suspend reject 为 P2 边缘 | interrupted 会静默无声；suspend 抛错会 fail-loud | 见 P1-1、P2-1 |
| pagehide 监听泄漏（medium） | 非独立缺陷 | 生产 overlay 会 dispose；pagehide 本身是释放路径 | 不单列 |
| release 非幂等 InvalidStateError（medium） | 不成立 | 二次进入时字段已空，且 close 有 `state !== 'closed'` 守卫 | 反驳 |
| `keepAlive === true` 罗嗦（low） | 非缺陷 | — | 不采纳 |
| dispose 注释「always tears down」（medium） | 文档 | 注入 capture 时本来就不该释放 | backlog |

## Findings

### P1-1：keep-alive 复用把「track 仍 live」当成「还能采到声音」，忽略 iOS 中断态

- 严重性：P1；置信度：8/10
- 溯源：规格 2（流仍 live 时复用且下次 start 必须真正采集；context 已 closed 才重建）以及规格 4 的隐含前提（间隙之后的下一次会话要能送出有效 PCM）。命中本仓 P1 红线「静默出错」。
- 本仓 P1 两问：
  1. 真实使用方式下会被触发吗？**会。** 本功能只服务 iOS 主屏 PWA；录音间隙后台/来电/Siri 是目标环境的常规事件。仓库已有实证：`docs/sessions/260819-1306-asr-spike-results.md` 记录 iOS 17.4 主屏 PWA 后台路径是 `track-mute → hidden → visible → track-unmute`。实现里 `installCaptureSignals` 已经把 `context.state === 'interrupted'` 当作一等中断信号，说明作者承认该态存在，但复用路径没有处理它。
  2. 触发了后果能否接受？**不能。** 第二次点录音后 UI 进入 Listening、无 `onError`，采集图是新建的，但 AudioContext 仍停在 `interrupted`，工作 let 不产出有效 PCM。用户以为在听，实际是静音会话。
- 位置：`src/asr/doubao/engine.ts` `hasReusableCapture`（314-321）、`restartHeldCapture`（252：只在 `'suspended'` 时 `resume()`）、`installCaptureSignals`（376-379：只在 **statechange** 时看 `interrupted`/`suspended`，不采样当前态）
- 证据：
  - 代码：`hasReusableCapture` 只拒绝 `context.state === 'closed'` 和 `readyState !== 'live'`。`restartHeldCapture`：`if (context.state === 'suspended') await context.resume()`。
  - 探针 `/tmp/keepalive-r1-probe.mjs`（H0 源码、仓外运行）：

    ```
    interrupted-reuse-resume: resumeCallsDelta=0, stateAfterSecondStart="interrupted", nodeCount=2
    suspended-reuse-resume:   resumeCallsDelta=1, stateAfterSecondStart="running",     nodeCount=2
    ```

    仓库测试 `reuses a live capture across start-stop-start` 在 interrupted 下仍会绿：它不断言 `resume()`、不断言第二轮 PCM、不断言 `FakeAudioNode.instances.length`。
  - 已 muted 的伴随缺口：keep-alive `stop()` 会 `clearCaptureSignals`，间隙中的 mute 没有监听。二次 start 时若 track 已经 `muted === true`，`onmute` 边沿不会再烧，5s `audio-interrupted` 计时器不会启动。**不要**用「muted 则重新 getUserMedia」去修——spike 写明 mute/unmute 可自动恢复且不应重新授权；正确修法是 `resume()` 非 running 的 context，并在复用时采样当前 `muted`/`interrupted`，已中断则走现有 `audio-interrupted` 或等到恢复。
- 建议修法：
  1. 复用前若 `context.state !== 'running'` 且未 closed，调用 `resume()`；resume 后仍非 running 则不要进入 recording 静默态，应 fail `audio-interrupted` 或按死流重建。
  2. 复用时若 track 已 muted，启动与录音中相同的 mute 计时器（或等价观测），禁止「Listening + 无错误 + 无 PCM」。
  3. 测试锁死：interrupted 二次 start 必须 `resume`（或报错）；已 muted 不得静默成功；二次 start 有新 worklet 且能 ingest PCM。

### P2-1：pagehide/release 只作废 capture.epoch，engine.epoch 仍自以为当前代

- 严重性：P2；置信度：9/10
- 溯源：规格 3（pagehide 必须完整释放）与规格 2 的 start 复用；降层三问 ②③。未标 P1：生产 `mic-controller` 在 `visibilitychange hidden` 且非 idle 时会 `cancelSession` → `engine.stop()`，会同时推进 engine.epoch。纯 capture 层的 pagehide 仍能单独把采集拆掉。
- 本仓 P1 两问：真实 iOS 切后台通常先 visibilitychange；page 被杀时 JS 上下文一并消失，空 recording 对用户不可见。故不升 P1。
- 位置：`src/asr/doubao/engine.ts` `onPageHide` → `release()`（154-156、437-446）；`start()` 在 epoch 失配时 `disposeStartResources` 后 **return 成功**（182-185 及 `restartHeldCapture` 253/261/267-269）；`DoubaoEngine.start()` 用自己的 epoch 判断 `isCurrent`（与 capture.epoch 独立）
- 证据：探针 `pagehide-during-gum`：

  ```
  engineStartResolved=true, trackStopCallsAfterStart=1,
  contextCount=0, nodeCount=0, secondStartThrows="ASR engine is busy"
  ```

  `release()` 不等待 in-flight `start()`，只 `epoch++` 后拆当前持有的 stream/context。过期的 `getUserMedia` 被丢掉并成功返回；engine 仍处于 `starting`/`recording`，表现为占线且没有采集图。
- 建议修法：pagehide/dispose 必须走 engine 层（`dispose()` 已经 `stop()`+`release()`）；capture 的 pagehide 应调用同一入口，或让 `capture.start` 在 epoch 失配时 **throw** 而不是 return，使 engine 不会切到 recording。给 in-flight start 与 release 加同一把锁（`stopPromise` 不够，release 目前不加入该链）。

### P2-2：轴表测试锁的是「没再要权限」，不是「复用后还能录音」

- 严重性：P2；置信度：10/10
- 溯源：规格 6 五格都有测试文件条目，但断言落在中间产物（`getUserMedia` 次数、`track.stopCalls`），看不见终态交付物（第二次会话的 PCM / context.running / 新 worklet）。命中「防线量纲必须与失败量纲一致」。
- 位置：`tests/asr-engine.test.ts` 1286-1437
- 证据：H0 上 5 条 keep-alive 测试全绿；仓外探针在 **不改生产代码** 的情况下证明：把 context 置为 `interrupted` 后，现有「reuse live capture」断言（gum=1、stopCalls=0、context 实例数=1）仍然全部成立，同时 `resumeCallsDelta=0`。规格 6 的「存活+keepAlive开：start→stop→start 仅 1 次 getUserMedia」写在测试里了，但「复用后的 start 真的在采集」没有锁。
- 另外：规格 3 的 pagehide 释放、规格 1 的 `navigator.standalone === true` 检测点，仓库测试为零。
- 建议修法：二次 start 断言 `resume`（或 state===running）、新 `AudioWorkletNode`、以及一条 PCM 能打到**第二根** socket；补 pagehide 与 standalone 门闩测试。不要把 muted 误测成「必须重新 getUserMedia」。

### P2-3：生产门闩 `isIosStandalonePwa()` 没有测试

- 严重性：P2；置信度：10/10
- 溯源：规格 1（仅 `navigator.standalone === true` 启用常驻；其他环境 stop 行为与改动前完全一致）
- 位置：`src/controls/mic-controller.ts` 67-71、110；`tests/mic-controller.test.ts` 无 `standalone`/`keepAlive` 命中
- 证据：`rg standalone tests/mic-controller.test.ts` 为空。keep-alive 行为测试全部通过 `new DoubaoEngine({ keepAlive: true })` 直注，绕过唯一生产检测点。检测实现本身（`Reflect.get(..., 'standalone') === true`）看起来正确，但规格 1 没有回归锁。
- 建议修法：mic-controller 在 `navigator.standalone === true` 时对自建 `DoubaoEngine` 注入 keepAlive、在 undefined/false 时不注入；现有 keepAlive-off 引擎测试继续锁非 PWA 行为。

### P3-1：controller.dispose 对自建引擎 fire-and-forget

- 严重性：P3；置信度：8/10
- 溯源：规格 3（完整释放发生在 controller/engine dispose）。无法证明会静默采错音，降为 P3。
- 位置：`src/controls/mic-controller.ts` 749-752
- 证据：`void createdEngine.dispose().catch(...)`。`DoubaoEngine.dispose()` 内部会 `stop()`+`release()` 并等待，但 controller 不等待该 Promise。overlay 卸载后页面通常也在拆，实际风险低于 P2-1。
- 建议修法：可保持 fire-and-forget，但 pagehide 应保证 `track.stop()` 在 handler 的同步段发出（现在整条 `release()` 都是 async）。

## 规格逐条对照

| 规格 | 结论 |
|---|---|
| 1 仅 iOS standalone 启用 | 生产门闩写法正确；**无测试**（P2-3）。keepAlive 默认 false，非 PWA 走旧 stop。 |
| 2 live 复用 / ended 重建 | live+suspended 复用正确（探针 resume=1，gum=1）。**interrupted 不 resume（P1-1）**。ended 重建有测试且走 `releaseHeldResources` 再 gum。 |
| 3 完整释放只在 dispose / pagehide / 死流重建前 | dispose 有测试且探针外的仓库用例锁 `track.stop`+`context.close` 各 1 次。pagehide 有监听，**无测试**；与 in-flight start 交错见 P2-1。keep-alive `stop()` 不再 `track.stop`/`context.close`，改为 suspend + 拆 worklet，符合本条。 |
| 4 间隙无 PCM、无 WebSocket | `stop()` 先 `epoch++` 并清空 `onSamples`；worklet 旧 epoch 的 pcm 被丢。engine `cleanupSession` 关 socket。仓库测试用旧 node 往**第一根** socket 打 pcm，锁的是 idle 后不再 send；实现看起来成立。 |
| 5 `AsrEngine` 不变、无用户配置 | `src/asr/types.ts` 不在 diff。`dispose`/`keepAlive` 在 `DoubaoEngine` / 内部 options，未进公开引擎接口或 config schema。 |
| 6 轴表五格 | H0 实际有 5 条测试（含 keepAlive 关），不是卡面「4 条」。覆盖 gum 次数与 stop/close 计数；**不覆盖复用后真正采集**（P2-2）。 |

## 四条路径走读（stop / pause / resume / release）

代码在 `src/asr/doubao/engine.ts` `BrowserPcmCapture`。pause/resume 不是公开方法，分别是 keep-alive 的 `stop()` 分支和随后 `start()` 的 `restartHeldCapture`。

### stop（keepAlive 关，应与 base 一致）

1. 若已有 `stopPromise`，返回同一 Promise。
2. 记下当前 epoch，然后 `epoch++`（作废 in-flight worklet 回调）。
3. 清空 `source`/`stream`/`node`/`context`/`onSamples`。
4. `clearCaptureSignals`；`track.stop()`；`stopCurrentEpoch`：flush → `port.close`/`disconnect` → `context.close()`。
5. 与 base `3254576` 相比：close 增加 `state !== 'closed'` 守卫；其余顺序一致。仓库测试 `recaptures and stops tracks on every session when keep-alive is off` 锁 2 次 gum + 每次 stop/close。

### pause（keepAlive 开且 `hasReusableCapture`）

1. 同上 epoch++、清 `source`/`node`/`onSamples`，**保留** `stream`/`context`。
2. `clearCaptureSignals`（此时起间隙中的 mute/ended/statechange 都听不到）。
3. **不** `track.stop()`。
4. `stopCurrentEpoch(..., pause=true)`：flush 后拆 worklet，若 context 非 closed/suspended 则 `suspend()`。
5. 符合规格 2「stop 不停 track、不关 context」。间隙 PCM 被 epoch/`onSamples=undefined` 双闸。engine 层 `cleanupSession` 关掉 WebSocket。

### resume（下次 `start()` → `restartHeldCapture`）

1. `start()` 先 await 上一次 `stopPromise`，再 `epoch++`。
2. `keepAlive && hasReusableCapture` 则走 `restartHeldCapture`，不再 `getUserMedia`。
3. 仅当 `state === 'suspended'` 时 `resume()`；**`interrupted` 会跳过**（P1-1）。
4. 重新 `addModule`、新 `AudioWorkletNode`、新 source、接图、`installCaptureSignals`、`postMessage start`。
5. epoch 失配时拆掉**新**图并 return 成功，留下仍 held 的 stream/context（给下一次 start）。pagehide 插在这些 await 中间时见 P2-1。

### release（`dispose()` / pagehide / 死流重建前）

1. `DoubaoEngine.dispose()`：`await stop()`（idle 时 no-op）再 `ownedCapture.release()`。
2. `release()`：卸 `pagehide` 监听，await `stopPromise`，`epoch++`，`releaseHeldResources`（同步清空字段后 `track.stop` + `context.close`）。
3. 死流：`hasReusableCapture` 为 false 时 `start()` 先 `releaseHeldResources` 再新 `getUserMedia`。
4. pagehide 回调是 `void this.release()`，不经过 engine.stop；与 in-flight start 的 epoch 域不同（P2-1）。
5. 控制器对自建引擎的 dispose 不等待 Promise（P3-1）。

## 降层三问

### ① 终态完成之前已发生哪些不可逆动作？顺序错了会怎样？

不可逆动作，按时间：

| 动作 | 发生点 | 顺序错的后果 |
|---|---|---|
| `getUserMedia`（权限/捕获开始） | `start()` 非复用分支 | 过期 epoch 已有 `disposeStartResources` 停轨；pagehide 交错时 engine 仍可能显示 Listening（P2-1） |
| `track.stop()` | 非 pause 的 stop、release、过期 start | 误 stop 会再要权限（本功能要避免的事）。pause 路径正确地没做。 |
| `AudioContext.close()` | 非 pause 的 stop / release | 误关则无法复用，只能再 gum。 |
| 向 provider 发 PCM / 开 WS | engine `recording`/`stopping` | 间隙被 epoch + idle 状态挡住，走读成立。 |
| `context.suspend()` | pause 的 `stopCurrentEpoch` | 若抛错，stop Promise reject，用户看到失败（fail-loud，不是 P1）。 |

识别结果交付在 engine 的 final/partial handler；keep-alive 不改变这条链。资源释放的终态是 track ended + context closed。pause 故意推迟该终态。

### ② 守卫用的 epoch 在实际运行形态下够不够？有没有两条路径同时持有「当前代」的错觉？

有两套代际，**不是一把锁**：

- `BrowserPcmCapture.epoch`：start/stop/release 各自 `++`。worklet 回调、flush-ack 按这个过滤。同对象上的 stop vs start 靠 `stopPromise` 串行，这一层是够的。
- `DoubaoEngine.epoch`：会话 start/stop/fail。`isCurrent` 只看这一套。

pagehide → `capture.release()` 只推进 capture.epoch，**不**推进 engine.epoch。于是出现探针里的错觉：engine 认为自己仍是当前会话（甚至已经 recording/busy），capture 已经把这一代作废并拆掉图。

单页面多次 start/stop：engine 忙则拒绝第二次 start，capture 侧靠 stopPromise。pagehide 与 in-flight start 并发：两条路径同时以为「自己是当前代」——engine 的当前代还活着，capture 的当前代已经 +1。

### ③ 保护覆盖的是「写入」还是「行为」？交错窗口

保护的是**行为**（麦克风是否还开着、PCM 是否还在飞、下次是否还弹权），不是某条状态字段的写入。

| 交错 | 以为的世界 | 实际窗口 |
|---|---|---|
| stop→pause 后 pagehide→release | 先暂停再卸 | release 会等 `stopPromise`，pause 完成后再 `track.stop`+`close`。这一对是安全的。 |
| pagehide→release 与 in-flight start | 已释放，不应再 recording | 探针：engine busy、无 context/node，track 已被停。以为活着其实已死，且占线。P2-1。 |
| pause 后 track ended | 下次 start 重建 | `hasReusableCapture` 会拒绝 ended，有测试。间隙中无 onended 监听，要等到下次 start 才发现。可接受。 |
| pause 后 context interrupted / track muted | 下次 start 复用且能采 | **以为还活着，实际采不到。** 不报错。P1-1。 |
| fire-and-forget dispose | 函数返回即已释放 | Promise 可能还在 close。P3-1。 |

## 熵增（反熵条款）

| 新增抽象 | 第二消费者 | 判定 |
|---|---|---|
| `DoubaoEngineOptions.keepAlive` | `BrowserPcmCapture` 构造 + `mic-controller` 生产注入 + 测试 | 有 |
| `BrowserPcmCapture.release` | `DoubaoEngine.dispose` + `pagehide` | 有 |
| `DoubaoEngine.dispose` | `mic-controller.dispose` + keep-alive 测试 | 有 |
| `isIosStandalonePwa` | 仅 mic-controller 内部 | 私有检测点，不是导出抽象；不单列 |
| `PcmCapture` 接口 | **未**增加 release（`61cc813` 明确避免） | 正确克制 |

没有「只有测试在用的导出配置项」。不因 OCR 的风格意见新增包装层。

## Backlog / 非本次 findings

- 存量：`docs/sessions/260819-1306-asr-spike-results.md` 已记录 iOS PWA mute/unmute 自动恢复；这是本 diff 应当接住的既有事实，不是新的存量 bug。
- 存量 issue #117（本地清单缺 `tsc --noEmit`）、#118（systemd unit 漂移）、#62（e2e 变慢）与本 PR 无关。
- OCR 未核实的风格/注释意见不进循环。
- `notify-panel.ts` 用 `display-mode: standalone` 检测 PWA，mic keep-alive 用 `navigator.standalone`。两者针对不同平台（后者才是 iOS 主屏），不是本 diff 引入的分叉，不记 finding。

## 验证命令与结果

在 detached H0 `61cc813`：

```
$ pnpm exec vitest run tests/asr-engine.test.ts
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Duration  1.08s

$ env -u FORCE_COLOR pnpm test
 Test Files  73 passed (73)
      Tests  1158 passed (1158)
   Duration  9.20s

$ env -u FORCE_COLOR pnpm exec tsx /tmp/keepalive-r1-probe.mjs
 interrupted-reuse-resume: resumeCallsDelta=0, state="interrupted", nodeCount=2
 suspended-reuse-resume:   resumeCallsDelta=1, state="running",     nodeCount=2
 pagehide-during-gum:      contextCount=0, nodeCount=0, secondStartThrows="ASR engine is busy"
 reuse-graph-rebuild:      gumCalls=1, trackStopCalls=0, nodeCount=2, resumeCalls=1
```

`pnpm run check` 在写入本 verdict 后于 card 分支再跑（只新增 markdown）。

## 最终 verdict

**fail**

P1-1 必须修：iOS PWA 录音间隙的中断态会让第二次录音静默无声。P2 三条应随修复补测试（resume/PCM、pagehide 与 engine 代际、standalone 门闩）。未达到「连续无新增 P1」的收敛条件；本轮是 R1。
