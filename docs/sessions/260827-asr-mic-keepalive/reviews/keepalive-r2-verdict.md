# PR #119：iOS PWA 麦克风常驻采集 R2 独立复验

- 审查对象（H1 冻结）：`3254576ce512af18cd46cf274ad37f9f41ffd98e..a63f01c77e52a5540d9f0f1db1be57d953904767`
- 提交：`f5259d0` feat keep-alive → `2c6c130` 轴表测试 → `61cc813` dispose 不进 PcmCapture → `19f631b` interrupted resume + fail-loud → `02e897e` / `a63f01c` 测试收口
- Diff：4 files，+374/−54（`src/asr/doubao/engine.ts`、`src/controls/mic-controller.ts`、`tests/asr-engine.test.ts`、`AGENTS.md`）
- 本轮视角：反向 / 误拒 + 交错并发（R1 已覆盖正向 stop/pause/resume/release 与 interrupted 不 resume）
- 风险等级：personal（采集生命周期 diff 按 internal 档自查；P1 红线仍是数据丢失 / 静默出错 / 崩溃）
- 结论：**fail**
- Findings 计数：**P1 1**（无本轮新增 P2/P3 待修项）

## 本轮新证据（开启审查前写明）

本轮结论依赖下列**本轮新获得**的证据，不是同一份 diff 的再次阅读，也不是 R1 视角换措辞：

1. 在 detached H1（`a63f01c`）工作树上实测：
   - `pnpm exec vitest run tests/asr-engine.test.ts` → 43/43 通过
   - `env -u FORCE_COLOR pnpm test` → 72 files / 1160 tests 通过；1 条 `tests/serve-abuse.test.ts`「explicit targets honor local-path」超时（30s），**不在本 diff 内**。同文件同用例立即重跑 724ms 通过，记为无关 flake。
2. 仓外探针 `/tmp/keepalive-r2-probe.mjs`（`pnpm exec tsx`，不改仓库）：stop 当时 muted、快速连点、stopPromise 期间 start、stop+pagehide、keep-alive 关、resume 微任务竞态。
3. 红验（工作树干净 → 只改判据一行 → 断言失败转红 → 只还原该行）：
   - fail-loud：`if (context.state !== 'running')` → `if (false && context.state !== 'running')`
   - muted 重建：`&& !track.muted` 删掉
   - keep-alive 关：`pause = this.keepAlive && this.hasReusableCapture(...)` → 去掉 `this.keepAlive &&`
4. OCR 前置：`ocr-review --from 3254576 --to a63f01c` 返回 `status=reviewed`（minimax / MiniMax-M3），9 条 finding 的 verifier 全部 `unverified`。下面只采纳经本轮走读/探针核实的条目。

## OCR 前置对照

| OCR 标注 | 本仓判定 | 两问 | 处置 |
|---|---|---|---|
| mic-controller if/else 罗嗦（low） | 非缺陷 | — | 不采纳 |
| controller.dispose 缺 keep-alive 层测试（medium） | 测试缺口；R1 P3-1 已接受 fire-and-forget | 卸载路径，不构成静默错结果 | backlog（R1 已裁决） |
| restartHeldCapture catch 一律 `releaseHeldResources`（high） | 对 resume 失败符合规格 2/6；addModule 失败顺带拆流偏保守 | addModule 在已成功加载后几乎不失败 | 不升 P1；记 backlog |
| release 与 in-flight stop 竞态（high） | 不成立为新 bug | `release()` 先 `await stopPromise`；探针 11 同拍释放干净 | 反驳 |
| pagehide `void release()` 未处理 reject（medium） | P3 级 | 卸载路径 | backlog（与 R1 dispose fire-and-forget 同类） |
| 注入 capture 时 dispose 不对称（medium） | 非缺陷 | 测试 seam，调用方自有生命周期；`61cc813` 有意不把 release 放进 `PcmCapture` | 不采纳 |
| `addEventListener` 无 typeof 守卫（low） | 非缺陷 | 生产是浏览器；H1 测试能构造 keep-alive 引擎 | 不采纳 |
| `keepAlive` 选项引擎层无 iOS 门闩（medium） | 非缺陷 | 规格 1 的生产门闩在 `mic-controller`；引擎选项是内部注入 | 不采纳 |
| 缺 pagehide 测试（medium） | 测试缺口 | R1 backlog：pagehide 与 in-flight start | backlog（已裁决接受） |

## Findings

### P1-1：keep-alive 的 `stop()` 用「能否复用」判定「能否暂停」，录音中 muted 会拆掉常驻流

- 严重性：P1；置信度：9/10
- 溯源：规格 2 第一句——keep-alive 开启时 stop **不** `track.stop()`、**不**关 context（改为 suspend + 拆 worklet）。规格 2 第二句的 muted/ended「按死流重建」约束的是**下一次 start**，不是 stop。本 finding 不反对「下次 start 时已 muted 则重建」（红验 2 证明那条测试锁得住）。
- 本仓 P1 两问：
  1. 真实使用方式下会被触发吗？**会。** 本功能只服务 iOS 主屏 PWA。仓库 spike（`docs/sessions/260819-1306-asr-spike-results.md`）写明 iOS 17.4 主屏 PWA 切后台顺序是 `track-mute`（比 `visibilitychange hidden` 早约 0.6s）→ hidden → visible → `track-unmute`。生产 `mic-controller` 在 hidden 且非 idle 时 `cancelSession` → `engine.stop()`（`src/controls/mic-controller.ts` 687-694、379-398）。stop 当时 `track.muted === true`。蓝牙切换导致录音中 mute 再点停止，是同一条代码路径。
  2. 触发了后果能否接受？**不能。** stop 成功返回、无 `onError`，但 `track.stop()` + `context.close()` 已经执行。下次点录音必然重新 `getUserMedia`。这正是本 PR 要消掉的 WebKit 再授权弹窗；对用户是「keep-alive 装上了，切一次后台就失效」，且过程无错误提示（静默丢掉常驻流）。
- 位置（H1 `a63f01c`）：
  - `src/asr/doubao/engine.ts` `hasReusableCapture`（323-330）：`readyState === 'live' && !track.muted`
  - 同文件 `stop()`（419）：`const pause = this.keepAlive && this.hasReusableCapture(stream, context)`
  - 同文件 `start()`（179-183）：同一 helper 决定复用还是 `releaseHeldResources` + 新 `getUserMedia`
- 证据：
  - 代码：keep-alive 是否暂停完全等于「现在能不能复用」。muted 让 helper 为 false，pause 分支不走，`track.stop()` 与 `context.close()` 执行。
  - 探针 `/tmp/keepalive-r2-probe.mjs` 在 H1 源码上跑（仓外，`pnpm exec tsx`）：

    ```
    stop-while-muted:
      gumCalls=1, trackStopCalls=1, contextCloseCalls=1, suspendCalls=0, readyState="ended"
    muted-stop-then-start:
      gumCalls=2, liveStopCallsAfterStop=1
    transient-mute-unmutes-before-stop:
      gumCalls=1, trackStopCallsAfterSecondStart=0
    ```

    对照：stop 前已经 unmute 则 keep-alive 成立。真实 iOS 后台是 hidden 时仍 muted、unmute 发生在回前台之后，走的是第一条。
  - 仓库测试锁不住这条：`rebuilds capture after the kept track is muted` 是 **stop 完成之后** 才把 `track.muted = true`，再二次 start。红验 2 只证明「start 前已 muted → gum=2」。没有任何用例在 **stop 当时** muted 后断言 `stopCalls === 0`。
- 建议修法：
  1. `stop()` 的 pause 条件改成 `this.keepAlive`（再加上 `stream`/`context` 仍在、context 未 closed）。ended/muted/resume 失败只在**下一次 start** 走重建或 fail-loud。
  2. 测试锁死：keep-alive start → 置 `muted=true` → stop → `track.stopCalls === 0` 且 `context.closeCalls === 0`；再 start 才允许 gum=2（或等 unmute 后复用，按产品选择，但 stop 本身不得拆流）。
  3. 不要再让 `hasReusableCapture` 同时回答「现在能不能暂停」和「下次能不能复用」两个问题。

## 规格逐条对照

| 规格 | 结论 |
|---|---|
| 1 仅 iOS standalone 启用 | 生产门闩 `isIosStandalonePwa()`（`=== true`）写法正确。三态测试锁纯函数。keep-alive 关路径探针 9 + 红验 3 锁 `gum=2` / 每次 `track.stop`。`createMicController` 是否把 `keepAlive: isIosStandalonePwa()` 注入引擎仍无控制器测试（R1 P2-3 残留，不新开）。 |
| 2 live 复用 / ended·muted 重建 / resume fail-loud | **stop 在 muted 时拆流（P1-1）**，违反第一句。start 侧：interrupted 会 resume（红验 1 锁 fail-loud）；start 前 muted/ended 会 gum=2（红验 2 锁 muted）。 |
| 3 完整释放只在 dispose / pagehide / 死流重建前 | dispose 路径仓库测试 + 探针 11（stop 与 pagehide 同拍）会 `track.stop`+`close`。pagehide 与 in-flight start 仍是 R1 backlog。 |
| 4 间隙无 PCM、无 WebSocket | 复用用例断言 idle 后旧 node 的 PCM 不再写入第一根 socket；engine `cleanupSession` 关 WS。本轮探针未发现间隙送帧。 |
| 5 `AsrEngine` 不变、无用户配置 | `git diff base..H1 -- src/asr/types.ts src/config-schema.ts` 为空。`keepAlive`/`dispose`/`release` 未进公开引擎接口。 |
| 6 复用时非 running 必须 resume；仍非 running 必须 fail-loud | 红验 1：去掉 running 判据后，`reports audio-interrupted when resume does not reach running` 以 **AssertionError**（promise resolved instead of rejecting）转红，不是 ImportError/SyntaxError。微任务级「resume resolve 后再翻成 running」不会误触发（探针 10：`await` 会排空该 microtask）。 |

## 本轮视角走读（误拒 / 交错 / keep-alive 关）

### 误拒：fail-loud 会不会在正常场景误触发？

| 场景 | 结果 |
|---|---|
| 桌面浏览器 suspend 慢 | keep-alive 生产只在 `navigator.standalone === true` 打开；桌面不走这条。规格 1。 |
| resume 异步、state 在下一个 microtask 才变 running | 探针 10：`startError=null`，`stateAfter=running`，`trackStopCalls=0`。`await resume()` 会排空 microtask，**不会**误 fail-loud。 |
| 蓝牙 / iOS 后台 mute 瞬态 | **会误拆流**（P1-1）。这不是 fail-loud 误报，是 pause 判定误用了复用谓词。 |
| 录音中 interrupted 后用户点停止 | 探针 4：pause 仍成立，`suspendCalls=1`，`trackStopCalls=0`。interrupted 本身不误杀流。 |
| 人为让 `suspend()` reject | 探针 5：`engine.stop()` 不抛（被 `reportStopError` 吃成 `connection-failed`），流仍握着。无 Safari 实证 interrupt 时 suspend 必 reject，不升 finding。 |

### 交错并发：epoch 会不会两代同时以为自己是当前？

探针在 H1 上：

```
rapid-start-stop-start: overlappingStart="ASR engine is busy", gumCalls=1, trackStopCalls=0, nodeCount=2
start-during-stopPromise: duringFlushStart="ASR engine is busy", gumCalls=1, contextCount=1
pagehide-during-reuse: start2Error=null, start3="ASR engine is busy", trackStopCalls=1, nodeCount=1
stop-and-pagehide-together: trackStopCalls=1, closeCalls=1, suspendCalls=1, state="closed"
```

- 快速连点 / stopPromise 期间再 start：引擎层 `state !== 'idle'` 直接拒，capture 层不会出现两代 start 并行。stop 完成后再 start 复用同一条流（gum 仍为 1）。**这一对成立。**
- pagehide 打在 reuse 的 `addModule` 上：capture `release()` 推进 capture.epoch 并拆流；engine.epoch / `starting` 不动，`capture.start` 对失配 **return 成功**，引擎进入 recording 且 `nodeCount=1`（没有第二张 worklet）。这是 R1 P2-1 同类（pagehide 与 in-flight start），**已裁决接受，不进本轮 findings**。本轮只确认 H1 修复 interrupted 后这条窗口还在。
- stop 与 pagehide 同拍：release 等完 stopPromise 再拆 held 资源，终态 closed/ended，没有「两个当前代」。

### 资源：keep-alive 关路径有没有被波及？

探针 9：`gumCalls=2, stop0=1, stop1=1, close0=1, close1=1, contextCount=2`。

红验 3：去掉 `this.keepAlive &&` 后，`recaptures and stops tracks on every session when keep-alive is off` 以断言失败转红（`stopCalls` 期望 1 实得 0）。规格 1 的默认路径有测试锁。

## 降层三问

### ① 终态完成之前已发生哪些不可逆动作？顺序错了会怎样？

| 动作 | 发生点 | 顺序错的后果 |
|---|---|---|
| `getUserMedia` | `start()` 非复用分支 | 过期 epoch 有 `disposeStartResources` 停轨；pagehide 交错时引擎仍可能 recording（R1 backlog） |
| `track.stop()` | 非 pause 的 stop、release、死流重建前 | **误 stop 会再要权限**。keep-alive 的 pause 路径不该做；P1-1 在 muted 时做了 |
| `AudioContext.close()` | 非 pause 的 stop / release | 误关则无法复用 |
| `context.suspend()` | pause 的 `stopCurrentEpoch` | reject 时 stop 被引擎编成 `connection-failed`（探针 5），流仍握着 |
| 向 provider 发 PCM / 开 WS | engine `recording`/`stopping` | 间隙被 capture.epoch + 清掉 `onSamples` + idle 关 socket 挡住 |
| fail-loud 后 `releaseHeldResources` | `restartHeldCapture` catch | 规格 2/6 要求 resume 失败拆流；addModule 失败同样拆，偏保守 |

识别结果仍走 engine 的 final/partial。keep-alive 改变的是麦克风资源终态的时间点：pause 故意推迟 `track.stop`/`close`。P1-1 把该推迟在 muted 时取消了。

### ② epoch 代际守卫在「快速连点 + pagehide 交错」下是否仍然唯一？

仍是两套代际，不是一把锁。

- `BrowserPcmCapture.epoch`：start/stop/release 各自 `++`。同对象 stop vs start 靠 `stopPromise` 串行。快速连点：引擎根本不让第二份 `capture.start` 进去。
- `DoubaoEngine.epoch`：会话 start/stop/fail。`isCurrent` 只看这一套。

快速连点 + stopPromise 等待期间 start：唯一当前代在引擎层（busy）。**成立。**

pagehide 打在 in-flight reuse start 上：capture 推进自己的 epoch 并拆资源，engine.epoch 不动，两边各以为自己是当前代。**不唯一。** 与 R1 P2-1 同一窗口，本轮不重复开 finding。

### ③ keep-alive 保留的 stream/context 在交错下，有没有「以为已释放但实际还握着麦克风」或反向窗口？

| 交错 | 以为的世界 | 实际窗口 |
|---|---|---|
| 录音中 muted → stop（P1-1） | keep-alive 暂停、下次不弹权 | **反向：以为还握着，其实已经 `track.stop`。** 下次 gum。 |
| stop 与 pagehide 同拍 | 先暂停再卸 | 探针 11：最终 stop+close 各 1，state=closed。这一对安全。 |
| pagehide 打在 reuse start | 已释放，不应 recording | 引擎 recording、无新 worklet。以为活着其实已死且占线。R1 backlog。 |
| 快速连点 | 第二下被拒或排队 | 被拒 busy；完成后复用。无双握。 |
| keep-alive 关两轮会话 | 每轮都释放 | 探针 9 证实。 |
| dispose fire-and-forget | 函数返回即已释放 | Promise 可能还在 close。R1 P3-1。 |
| interrupted 时 suspend reject | stop 失败 | 引擎不抛、流仍握着（探针 5）。无真机实证，不升 finding。 |

本轮新发现的可触发窗口是第一行（过早释放），不是泄漏。

## 红验原文（断言失败，非 ImportError/SyntaxError）

注入前 `git status --porcelain` 为空；每次只改一行，还原只还原该行。

**红验 1**（规格 6 fail-loud）注入后 `sed -n '258p'`：

```
if (false && context.state !== 'running') {
```

```
FAIL  tests/asr-engine.test.ts > … > reports audio-interrupted when resume does not reach running
AssertionError: promise resolved "undefined" instead of rejecting
 ❯ tests/asr-engine.test.ts:1371:31
    await expect(engine.start()).rejects.toThrow('did not resume')
```

**红验 2**（规格 2 start 侧 muted 重建）注入后 `sed -n '329p'`：

```
return tracks.length > 0 && tracks.every((track) => track.readyState === 'live')
```

```
FAIL  tests/asr-engine.test.ts > … > rebuilds capture after the kept track is muted
AssertionError: expected "spy" to be called 2 times, but got 1 times
 ❯ tests/asr-engine.test.ts:1391:26
    expect(getUserMedia).toHaveBeenCalledTimes(2)
```

ended 用例仍 skip/绿（同一 `test.each` 的另一格），说明注入点确实在 muted 谓词上。

**红验 3**（规格 1 keep-alive 关）注入后 `sed -n '419p'`：

```
const pause = this.hasReusableCapture(stream, context)
```

```
FAIL  tests/asr-engine.test.ts > … > recaptures and stops tracks on every session when keep-alive is off
AssertionError: expected +0 to be 1
 ❯ tests/asr-engine.test.ts:1412:40
    expect(streams[0]?.track.stopCalls).toBe(1)
```

三处均已还原；`git diff a63f01c -- src/asr/doubao/engine.ts` 为空后再切回 card 分支写本文件。

## 反熵（每个新增抽象的第二消费者）

| 新增抽象 | 第二消费者 | 判定 |
|---|---|---|
| `DoubaoEngineOptions.keepAlive` | `BrowserPcmCapture` 构造 + `mic-controller` 生产注入 + 测试 | 有 |
| `BrowserPcmCapture.release` | `DoubaoEngine.dispose` + `pagehide` | 有 |
| `DoubaoEngine.dispose` | `mic-controller.dispose` + 测试 | 有 |
| `hasReusableCapture` | `start()` 复用判定 + `stop()` pause 判定 | 有——但两个消费者问的不是同一个问题，这正是 P1-1 |
| `bindWorkletNode` / `teardownGraph` / `releaseHeldResources` | start / restart / stop / release 多处 | 有 |
| `isIosStandalonePwa` | 生产注入 + 三态测试 | 有 |
| `AudioInterruptedError` → `audio-interrupted` | `restartHeldCapture` throw + `errorCode()` | 有 |

没有「只有测试在用的导出配置项」。`AsrEngine` / 用户 config 未加字段。

## Backlog / 非本次 findings

- R1 已裁决接受：pagehide 与 in-flight start 交错（本轮探针 8 仍能复现）；controller.dispose fire-and-forget。
- R1 P2-3 残留：`isIosStandalonePwa` 纯函数已测，`createMicController` 注入 `keepAlive` 仍无控制器测试。
- OCR：`restartHeldCapture` 在 addModule 失败时也 `releaseHeldResources`（偏保守）；pagehide `void release()` 未 catch。
- 全量 `pnpm test` 中 `tests/serve-abuse.test.ts` 图像投放绑定用例超时一次，不在本 diff，重跑通过。
- 存量 issue #117 / #118 / #62 与本 PR 无关。

## 验证命令与结果

在 detached H1 `a63f01c`：

```
$ pnpm exec vitest run tests/asr-engine.test.ts
 Test Files  1 passed (1)
      Tests  43 passed (43)
   Duration  1.04s

$ env -u FORCE_COLOR pnpm test
 Test Files  1 failed | 72 passed (73)
      Tests  1 failed | 1160 passed (1161)
 FAIL  tests/serve-abuse.test.ts > image drop attachment binding > explicit targets honor local-path
 Error: Test timed out in 30000ms.

$ env -u FORCE_COLOR pnpm exec vitest run tests/serve-abuse.test.ts -t "explicit targets honor local-path"
 Tests  1 passed | 5 skipped (6)
   Duration  1.17s   # 724ms，判定为无关 flake

$ env -u FORCE_COLOR pnpm exec tsx /tmp/keepalive-r2-probe.mjs
 stop-while-muted:                 trackStopCalls=1, closeCalls=1, suspendCalls=0
 muted-stop-then-start:            gumCalls=2
 transient-mute-unmutes-before-stop: gumCalls=1, stopCalls=0
 rapid-start-stop-start:           overlapping="ASR engine is busy", gum=1
 start-during-stopPromise:         duringFlush="ASR engine is busy", gum=1
 pagehide-during-reuse:            start2Error=null, start3=busy, nodeCount=1
 keepalive-off-two-sessions:       gum=2, stop0=1, stop1=1
 resume-resolves-before-running-microtask: startError=null, state=running
 stop-and-pagehide-together:       stop=1, close=1, state=closed
```

`pnpm run check` 在写入本 verdict 后于 card 分支再跑（只新增 markdown）。

## 最终 verdict

**fail**

P1-1 必须修：iOS PWA 录音中切后台（先 mute 再 hidden→cancel→stop）会把常驻流拆掉，下次语音输入重新弹权。这是规格 2 第一句的违反，也是本功能主路径上的静默失效。R1 的 interrupted-resume P1 在 H1 已锁住（红验 1）；本轮反向视角发现的是「修 muted 复用时把同一谓词接到了 stop 上」。未达到「连续无新增 P1」的收敛条件。
