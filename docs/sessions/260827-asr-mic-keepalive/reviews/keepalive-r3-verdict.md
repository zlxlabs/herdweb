# PR #119：iOS PWA 麦克风常驻采集 R3 全量复验

- 审查对象（H2 冻结）：`3254576ce512af18cd46cf274ad37f9f41ffd98e..d742edeb585994395f1f556f72c678daed3642ef`
- 提交链：`f5259d0` feat keep-alive → `2c6c130`/`61cc813` 轴表与 dispose 收口 → `19f631b` interrupted resume + fail-loud（R1 P1 修复）→ `02e897e`/`a63f01c` 测试收口 → `5613ed2` 谓词拆分（R2 P1 修复）→ `d742ede` muted 用例锁
- Diff：4 files，+422/−54（`src/asr/doubao/engine.ts`、`src/controls/mic-controller.ts`、`tests/asr-engine.test.ts`、`AGENTS.md`）
- 本轮视角（R1/R2 未系统覆盖的方向）：**引擎层（DoubaoEngine）状态迁移 × capture 层 pause/复用/看门狗的交错**；测试充分性反向核对（改坏一行会不会红）；Web Audio / MediaStream API 语义核对
- 风险等级：personal（采集生命周期 diff 按 internal 档自查；P1 红线：数据丢失 / 静默出错 / 崩溃）
- 结论：**pass**
- Findings 计数：**新增 P1 0、P2 0、P3 0**（新观察均落在 backlog，见末节）

## 本轮新证据（开启审查前写明）

1. 在 detached H2（`d742ede`）工作树上实测：
   - `pnpm exec vitest run tests/asr-engine.test.ts` → 46/46 通过（571ms）
   - `pnpm test` → 73 files / 1164 tests 全绿（9.70s），无 flake
2. 仓外探针 `/tmp/keepalive-r3-probe.mjs`（`pnpm exec tsx`，不改仓库，真实定时器）：7 组引擎失败路径 × capture pause/复用/看门狗交错组合，输出原文见「探针输出」节。
3. 4 格最小注入红验（工作树干净 → 只改判据一行 → 断言失败转红 → 只还原该行；注入后均用 `sed -n` 确认落点；全部还原后 46/46 复绿、`git diff H2` 为空）。输出原文见「红验原文」节。
4. Web Audio 语义外部核对：WebKit `interrupted` 提案与实测讨论（[web-audio-api#2392](https://github.com/WebAudio/web-audio-api/issues/2392)、[MSEdge explainers: AudioContextInterruptedState](https://microsoftedge.github.io/MSEdgeExplainers/AudioContextInterruptedState/explainer.html)、[web-audio-api#2585](https://github.com/WebAudio/web-audio-api/issues/2585)）：interrupted 期间 `resume()` 会 reject 或不变更状态；`suspend()` 的规范 reject 条件仅为 closed / document 非 fully-active。
5. 对 base（`3254576`）旧版 `stop()`/worklet `flush` 的直接阅读，用于区分存量行为与本 diff 引入的行为。

## 规格逐条对照

| 规格 | 结论 |
|---|---|
| 1 仅 iOS standalone（`navigator.standalone === true`）启用；其他环境 stop 行为与改动前一致 | 生产门闩在 `createMicController`（`keepAlive: isIosStandalonePwa()`），默认 false；`isIosStandalonePwa` 三态测试锁定；keepAlive 关路径由 `recaptures and stops tracks on every session when keep-alive is off` 锁定（R2 红验 3 在 H1 证明该锁有效，H2 该行未变）。✔ |
| 2 stop 的 pause 判定只问「资源还活着吗」（context 未 closed 且有 live track；muted 不影响） | `hasPausableCapture` = context 未 closed + `some(readyState==='live')`，不含 muted。红验 1：把 muted 加回谓词，`pauses a muted live track without stopping it` 转红（stopCalls 0→1）。探针 A：stop 时 muted → 流保持（stopCalls=0、closeCalls=0、suspendCalls=1）。✔ |
| 2 start 的 reuse 判定只问「能不能直接采」（全部 track live 且 context 未 closed）；ended/closed → 拆残骸 + 重新 gum | `canReuseHeldCapture` = `every(live)` + 未 closed。`rebuilds capture after the kept track has ended` 锁 ended 重建；`releaseHeldResources` 先清字段再拆，无残留。✔ |
| 2 复用时非 running 必须 resume；仍非 running 必须 fail loud（`audio-interrupted`） | `restartHeldCapture`：`state !== 'running'` → `await resume()` → 再查仍非 running → 抛 `AudioInterruptedError` → `errorCode` 映射 `audio-interrupted`。红验 4：打断映射后 `reports audio-interrupted when resume does not reach running` 转红（`['connection-failed']` vs 期望 `['audio-interrupted']`）。探针 F2：interrupted 失败后下一次 start 实际 resume（resumeCalls=1）且 PCM 送达第二根 socket。✔ |
| 2 start 当时 track 已 muted：复用 + 5s 看门狗；到期仍 muted 报 `audio-interrupted`；期间 unmute 取消 | `installCaptureSignals` 末尾 `if (track.muted)` 武装看门狗；`onunmute` 清除。红验 2：置废武装行后 `start-muted watchdog timeout=true` 转红（`[]` vs 期望 `['audio-interrupted']`），timeout=false（unmute 取消）格仍绿——注入点精确落在武装行。探针 A2/A3：provider 报错失败后复用 muted 流，gum 仍 1 次，5s 后 `audio-interrupted` 如期上报。✔ |
| 3 完整释放只在 dispose / pagehide / 死流重建前 | 探针 A4/F3：`dispose()` 后 track.stop/close 各恰好 1 次；探针 A–G 各失败路径中均无提前释放。pagehide→`release()` 路径本体未变（与 in-flight start 的交错为 R1/R2 已裁决接受的 backlog）。✔ |
| 4 录音间隙不向 provider 发 PCM、不占用 WebSocket | 探针 A：fail 后旧 node 的 PCM 被丢（`pcmDroppedAfterFail=true`）、socket 已关（readyState=3）；探针 D：stop（final 超时 3s）后 socket 关闭、流保持；间隙无发送。双闸机制：capture 层 epoch 失配先丢 + `onSamples=undefined`，engine 层 `cleanupSession` 关 WS。✔ |
| 5 `AsrEngine` 接口不变；不新增用户配置项 | diff 不触 `src/asr/types.ts` / `src/config-schema.ts`；`dispose()`/`keepAlive` 均在 `DoubaoEngine` 具体类与内部 options，未进公开接口与 config。✔ |

## 本轮视角走读（引擎层 × capture 层交错）

探针 7 组（全部真实定时器、H2 源码直跑）：

| 组合 | 结果 |
|---|---|
| A 录音中 muted + provider 报错 → engine fail → capture stop | fail-loud 单次 `provider-error`；muted live 流被 **pause 保持**（stop=0/close=0/suspend=1）；复用不再 gum；5s 看门狗报 `audio-interrupted`；dispose 恰好各释放 1 次 |
| B 录音中 WS runtime error → fail → 再 start | `connection-failed` 单次；流保持；复用 resume=1；第二会话 PCM 送达新 socket |
| C 录音中 backpressure（bufferedAmount 超限）→ fail | `network-too-slow`；pause 保持；复用 gum=1 |
| D stop 后 provider 不发 final | 3s 超时收束，无错误；流保持；socket 关闭 |
| E stopping 途中 provider 报错（capture 正在 pause） | `provider-error` 单次（`failedDuringStop` 去重），stop 正常 resolve，流保持 |
| F 录音中 context interrupted 且 worklet 不应答 flush（渲染停摆） | 3s flush 超时 → `audio-interrupted` 单次；对 interrupted context 尝试 suspend；engine 到 idle 不挂死；下一次 start resume 成功、PCM 恢复 |
| G pause 时 `suspend()` reject（模拟 WebKit interrupted 怪癖） | stop 不向调用方抛、上报 `connection-failed`（fail-loud）；流仍保持；下一次 start 照常复用 resume |

走读补充（无探针但代码可判定）：

- 引擎失败路径对 capture 只有**一个入口**：`fail`/`finishStop`/`finishFailure` 全部经 `requestCaptureStop()` 单飞（`captureStopPromise` 去重），capture 内部 stop/start 再经 `stopPromise` 串行。E 组证明 stopping 与 failing 交错时不会二次进入 capture.stop。
- 引擎 catch 中重复 `this.fail(errorCode(error), epoch)` 是安全的：`fail` 首行 `epoch !== this.epoch` 即返回（fail 已 `epoch++`），不会双报。`reports audio-interrupted…` 断言 `errors` 恰好 1 条锁住了这点。
- start 取消（cancel-start）时若上一次会话 pause 持有的流还在：`capture.stop()` 的 pause 谓词对「held 但无 source/node」仍判 alive → 继续持有，不释放不重建——符合 keep-alive 语义。
- backpressure 监视器只在 recording 运行（stop/fail 先 `stopBackpressureMonitor`），pause 的 flush 与其无交互窗口；`workletPosted/workletReceived` 在每次 `capture.start` 开头清零，复用会话不带旧账。

## Web Audio / MediaStream API 语义核对

| 实现假设 | 规范/实现事实 | 判定 |
|---|---|---|
| `track.muted` 是瞬态：mute ≠ ended，`readyState` 仍 `live`，可能自动 unmute（仓内 spike 实测） | 与 MediaStream 规范一致。两个谓词都只读 `readyState`，muted 走看门狗——依赖正确 | ✔ |
| `suspend()` 只在非 closed/非 suspended 时调用 | 规范 reject 条件为 closed（及 document 非 fully-active）；interrupted 下 suspend 的 WebKit 行为无文档。探针 G：即便 reject 也是 fail-loud 且流保持，两种语义下都安全 | ✔ |
| `resume()` 后仍非 running → fail loud | 已锁定（红验 4 + R2 红验 1）。**剩余语义风险**：WebKit interrupted 提案明确「interrupted 期间 resume 会 reject」——若真机如此，reject 走 `restartHeldCapture` 的 catch：拆流 + `errorCode` 落入 `connection-failed`（误标，非静默）。无真机实证，记 backlog | backlog |
| `close()` 前查 `state !== 'closed'`；suspended/interrupted 可 close | 规范允许从任何非 closed 态 close | ✔ |
| interrupted 时 worklet port 消息不处理 → flush 无 ack | 探针 F：3s `CAPTURE_FLUSH_TIMEOUT` 收束为 fail-loud，不挂死 | ✔ |

## 降层三问

### ① 不可逆动作清单与顺序

| 动作 | 发生点 | 顺序验证 |
|---|---|---|
| `getUserMedia`（占用麦克风/可能弹权） | 仅 fresh start（谓词判不可复用或残骸清理后） | 探针 A/B/C/F：失败后续会话 gum 均保持 1；只有 ended/closed/dispose 后才再 gum |
| WS 建连 + full request | engine start，先于 `capture.start` | capture 失败 → `fail` → `detachAndCloseSocket`，无孤儿 socket（探针 F 后 socket 复用新实例） |
| PCM / end frame 发送 | 仅 recording/stopping | 间隙双闸（capture epoch + onSamples 清空；engine cleanup 关 WS），探针 A/D 证实 |
| `context.suspend()` | pause 的 flush 之后 | 可逆（resume）；reject 也 fail-loud（探针 G） |
| `track.stop()` / `context.close()`（不可逆） | 非 pause 的 stop、`release()`、死流重建前 | 全探针组合中 pause 期间 0 次；dispose 后恰好各 1 次；红验 3：pause 分支若误调 close，`reuses a live capture` 转红（closeCalls 1 vs 0） |
| pagehide 监听挂/卸 | 构造（keepAlive）/`release()` | 成对，无泄漏路径 |

顺序上未发现「终态未完成就先做不可逆动作」的组合。

### ② 两套 epoch 守卫在引擎失败路径叠加 capture pause 时是否仍唯一

- `BrowserPcmCapture.epoch`：start/stop/release 各自 `++`；worklet 回调、flush-ack、看门狗 `reportInterruption` 全部按它过滤；同对象 stop/start 经 `stopPromise` 串行。
- `DoubaoEngine.epoch`：会话级；`isCurrent` 只看它。
- 引擎失败路径（provider/WS/backpressure/final 超时）全部经 `requestCaptureStop()` 单飞进入 capture.stop——失败叠加 pause 时 capture 侧仍只有一次 stop、一代 epoch。探针 E（stopping 途中再失败）证明 `failedDuringStop` 去重有效，错误单次。
- 已知且已裁决接受的**唯一**非唯一窗口：pagehide 直驱 `capture.release()` 不推进 engine.epoch，engine 可能停在 recording 而采集已被拆（R1 P2-1，本轮探针未再复测该窗口，H2 未触碰此路径）。本轮未发现新的「双当前代」。

### ③ 谓词拆分后还有没有「以为暂停了其实拆了」/「以为活着其实采不到且不报错」的窗口

- 「以为暂停了其实拆了」：**未发现。** pause 谓词 = keepAlive + context 未 closed + 存在 live track；muted 不再影响（红验 1 锁回归）；stop 时全 ended/context closed 的拆流是「资源已死」的正确处置（`releases capture when stop sees ended tracks` 锁定）。
- 「以为活着其实采不到且不报错」：**规范内状态全覆盖**——interrupted（resume + running 复查 + fail-loud，探针 F/F2）、suspended（resume）、muted（5s 看门狗，红验 2 + 探针 A3）、ended/closed（重建）。残余两条均记 backlog：(a) `resume()` 自身 reject 时误标 `connection-failed` 且拆流（响亮但错码，无真机实证）；(b) track 无 muted 标志地产出静音（无 API 可探测，超出实现能力）。

## 测试充分性反向核对（每格问「改坏那行会不会红」）

| 矩阵格 | 锁定用例 | 红验 |
|---|---|---|
| stop 时 muted → 仍 pause（规格 2 谓词一，R2 P1 回归） | `pauses a muted live track without stopping it` | 红验 1 ✔ |
| pause 不 close context（规格 2/3） | `reuses a live capture…` 的 `closeCalls=0` | 红验 3 ✔ |
| start 时 muted → 看门狗（规格 2） | `start-muted watchdog timeout=true/false` | 红验 2 ✔（false 格同时证明未误伤 unmute 取消） |
| resume 失败 → `audio-interrupted`（规格 2，引擎层映射） | `reports audio-interrupted when resume does not reach running` | 红验 4 ✔ |
| ended → 重建（规格 2） | `rebuilds capture after the kept track has ended` | R2 红验 2（H1）已证该锁有效，H2 未改对应行 |
| keepAlive 关 → 每轮释放（规格 1） | `recaptures and stops tracks…keep-alive is off` | R2 红验 3（H1）已证，H2 未改对应行 |
| 间隙不发 PCM（规格 4） | `reuses a live capture…` 的 idleSent 断言 + 探针 A/D | 探针 ✔ |

弱格（记 backlog，不达 finding）：`canReuseHeldCapture` 的 `every` 在单 track fake 下与 `some` 不可区分（注入 `every→some` 不会红）；生产 `getUserMedia({audio:true})` 单音轨，且部分 ended 的复用后果是「活着的那轨继续采」非静默失败，故不补测也可接受。`createMicController` 注入 keepAlive 无控制器测试（R1 起已裁决接受）。

## 反熵（每个新增抽象的第二消费者）

| 新增抽象 | 消费者 | 判定 |
|---|---|---|
| `hasPausableCapture` / `canReuseHeldCapture` | 各一个（stop / start） | 各单消费者，但这是对 R2 P1 的**谓词拆分**修复（一个谓词答两个问题是缺陷本体），拆分即修复，非熵 |
| `releaseHeldResources` | start 死流重建 / restart catch / release | 3 处 |
| `teardownGraph` / `bindWorkletNode` | start / restart / dispose 多处复用 | 多处 |
| `BrowserPcmCapture.release` | engine dispose / pagehide | 2 处 |
| `DoubaoEngine.dispose` / `ownedCapture` | mic-controller dispose / 测试 | 有；ownedCapture 区分自有与注入 capture，避免误拆注入物 |
| `keepAlive` option / `isIosStandalonePwa` | 引擎构造 / 生产门闩 / 测试 | 有 |
| `AudioInterruptedError` → `errorCode` | restart 抛出 / 映射 / 用例断言 | 有（红验 4 证明映射被测试锁定） |

未见「只有测试在用」的导出或转发-only 层。

## 红验原文（均为断言失败，非 ImportError/SyntaxError）

注入前 `git status --porcelain` 为空；每格只改一行、`sed -n` 确认落点、验后只还原该行；四格全部还原后 `git diff d742ede -- src/asr/doubao/engine.ts` 为空且 46/46 复绿。

**红验 1**（规格 2 stop-pause 谓词；注入后第 328 行）：

```
return stream.getTracks().some((track) => track.readyState === 'live' && !track.muted)
```

```
FAIL |dom| tests/asr-engine.test.ts > … > pauses a muted live track without stopping it
AssertionError: expected 1 to be +0 // Object.is equality
 ❯ tests/asr-engine.test.ts:1411:31
    expect(stream.track.stopCalls).toBe(0)
 Tests  1 failed | 45 skipped (46)
```

**红验 2**（规格 2 muted 看门狗；注入后第 392 行）：

```
if (false && track.muted) this.muteTimers.set(track, setTimeout(reportInterruption, 5_000))
```

```
FAIL |dom| tests/asr-engine.test.ts > … > start-muted watchdog timeout=true
AssertionError: expected [] to deeply equal [ 'audio-interrupted' ]
 Tests  1 failed | 1 passed | 44 skipped (46)   # timeout=false 格仍绿，注入点精确
```

**红验 3**（规格 2/3 pause 不 close；注入后第 499-501 行 pause 分支改为 `await context.close()`）：

```
FAIL |dom| tests/asr-engine.test.ts > … > reuses a live capture, resumes interrupted context, and delivers PCM
AssertionError: expected 1 to be +0 // Object.is equality
 ❯ tests/asr-engine.test.ts:1348:31   (expect(context.closeCalls).toBe(0))
 Tests  1 failed | 45 skipped (46)
```

**红验 4**（规格 2 引擎层错误映射；注入后第 72 行匹配名改为 `AudioInterruptedErrorXXX`）：

```
FAIL |dom| tests/asr-engine.test.ts > … > reports audio-interrupted when resume does not reach running
AssertionError: expected [ 'connection-failed' ] to deeply equal [ 'audio-interrupted' ]
 ❯ tests/asr-engine.test.ts:1379:19
 Tests  1 failed | 45 skipped (46)
```

## 探针输出（`/tmp/keepalive-r3-probe.mjs` 原文）

```
{"probe":"A provider-error-while-muted","errors":"[\"provider-error\"]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1,"socketClosed":true,"pcmDroppedAfterFail":true}
{"probe":"A2 reuse-after-provider-error","gumCalls":1,"errors":"[\"provider-error\"]"}
{"probe":"A3 muted-watchdog-after-reuse","errors":"[\"provider-error\",\"audio-interrupted\"]"}
{"probe":"A4 dispose-releases","trackStopCalls":1,"closeCalls":1}
{"probe":"B ws-runtime-error-then-reuse","errors":"[\"connection-failed\"]","gumCalls":1,"trackStopCalls":0,"closeCalls":0,"resumeCalls":1,"secondSessionPcmSent":true}
{"probe":"C backpressure-fail-pauses","errors":"[\"network-too-slow\"]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1}
{"probe":"C2 reuse-after-backpressure-fail","gumCalls":1}
{"probe":"D stop-final-timeout","elapsedMs":3000,"errors":"[]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1,"socketClosed":true}
{"probe":"E provider-error-during-stopping","errors":"[\"provider-error\"]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1}
{"probe":"F interrupted-no-flush-ack","elapsedMs":3601,"errors":"[\"audio-interrupted\"]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1}
{"probe":"F2 reuse-after-interrupted-fail","gumCalls":1,"resumeCalls":1,"pcmSent":true,"errors":"[\"audio-interrupted\"]"}
{"probe":"F3 dispose-releases","trackStopCalls":1,"closeCalls":1}
{"probe":"G suspend-rejects-on-pause","errors":"[\"connection-failed\"]","trackStopCalls":0,"closeCalls":0,"suspendCalls":1}
{"probe":"G2 reuse-after-suspend-reject","gumCalls":1,"resumeCalls":1,"errors":"[\"connection-failed\"]"}
```

## Backlog / 非本次 findings

- （新观察，沿用 R2 已裁决条目扩展）`restartHeldCapture` 的 catch 一律 `releaseHeldResources` + 统一 `errorCode`：若 WebKit 按 interrupted 提案在 interrupted 下 **reject** `resume()`（[web-audio-api#2392](https://github.com/WebAudio/web-audio-api/issues/2392)、[Edge explainer](https://microsoftedge.github.io/MSEdgeExplainers/AudioContextInterruptedState/explainer.html)，无真机实证），用户看到 `connection-failed`（误标，非静默）且常驻流被拆、下一次重新弹权。判「接受不修」：失败响亮、场景为真实通话中断边缘、修法（区分 reject 原因）要等真机语义确认才有依据。
- （新观察，存量非本 diff）worklet `flush` 会先吐出尾部缓冲块（`emitChunk(true)`，至多 PCM_CHUNK_SAMPLES=1600 ≈ 100ms），但 base 起 `stop()` 先 `epoch++` + 清 `onSamples` 再发 flush，尾包按 stale epoch 丢弃——用户停录前最后约 100ms 不送 provider。base `3254576` 同序，属存量，记此备查。
- （新观察，测试弱格）`canReuseHeldCapture` 的 `every` vs `some` 在单 track fake 下不可区分；生产单音轨，风险可忽略。
- （沿用 R1/R2 已裁决接受）pagehide 与 in-flight start 交错（engine.epoch 不推进）；controller.dispose fire-and-forget；pagehide `void release()` 未 catch；`createMicController` 注入 keepAlive 无控制器测试。
- 存量 issue #117/#118/#62 与本 PR 无关。

## 验证命令与结果

在 detached H2 `d742ede`：

```
$ pnpm exec vitest run tests/asr-engine.test.ts
 Test Files  1 passed (1)
      Tests  46 passed (46)
   Duration  1.02s

$ pnpm test
 Test Files  73 passed (73)
      Tests  1164 passed (1164)
   Duration  9.70s

$ env -u FORCE_COLOR pnpm exec tsx /tmp/keepalive-r3-probe.mjs
（输出见「探针输出」节，14 行全部符合预期）
```

红验还原后复跑 `pnpm exec vitest run tests/asr-engine.test.ts` → 46/46 绿，`git status --porcelain` 空。`pnpm run check` 在 card 分支写入本 verdict 后跑（仅新增 markdown）。

## 最终 verdict

**pass**

规格 5 条逐条有锁（测试 + 红验 + 探针三层），R1/R2 两处 P1 的修复在 H2 上均有回归锁且经本轮红验确认锁有效；引擎失败路径 × capture pause/复用/看门狗的 7 组交错无一产生静默无声、误拆流、资源泄漏或状态机挂死。本轮无新增 P1/P2/P3 finding。谓词拆分后未发现「以为暂停了其实拆了」或「以为活着其实采不到且不报错」的残留窗口（规范可表达的状态范围内）。
