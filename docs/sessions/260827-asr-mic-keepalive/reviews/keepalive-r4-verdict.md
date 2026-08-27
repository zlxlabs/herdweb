# PR #119：iOS PWA 麦克风常驻采集 R4 收敛轮

- 审查对象（H2 冻结）：`3254576ce512af18cd46cf274ad37f9f41ffd98e..d742edeb585994395f1f556f72c678daed3642ef`
- 提交链：`f5259d0` feat keep-alive → `2c6c130`/`61cc813` 轴表与 dispose 收口 → `19f631b` interrupted resume + fail-loud → `02e897e`/`a63f01c` 测试收口 → `5613ed2` 谓词拆分 → `d742ede` muted 用例锁
- Diff：4 files，+422/−54（`src/asr/doubao/engine.ts`、`src/controls/mic-controller.ts`、`tests/asr-engine.test.ts`、`AGENTS.md`）
- 本轮视角（R1 正向 / R2 反向并发 / R3 引擎交错已覆盖，本轮不复扫那些轴）：**controller 集成边界**（setTarget、visibilitychange→cancelSession、preview/确认/重录、dispose；`createdEngine` vs 注入 engine 的 dispose 不对称）+ **keepAlive=off 跨平台等价**（逐 `this.keepAlive` 分叉对照 base）+ **客户端打包 / worklet URL**
- 风险等级：personal（采集生命周期 diff 按 internal 档自查；P1 红线：数据丢失 / 静默出错 / 崩溃）
- 结论：**pass**
- Findings 计数：**新增 P1 0、P2 0、P3 1**（P3 接受进 backlog，不阻塞收敛）

## 本轮新证据（开启审查前写明）

本轮结论依赖下列**本轮新获得**的证据，不是同一份 diff 的再次阅读，也不是 R1–R3 视角换措辞：

1. 在 detached H2（`d742ede`）工作树上实测：
   - `pnpm exec vitest run tests/asr-engine.test.ts` → 46/46 通过（574ms）
   - `env -u FORCE_COLOR pnpm test` → 73 files / 1164 tests 全绿（9.83s）
2. 仓外探针 `/tmp/keepalive-r4-probe.mts`（`pnpm exec tsx`，不改仓库）：
   - H2：controller `createdEngine` 路径下 setTarget / visibilitychange / preview 重录 / dispose；注入 engine 路径；keepAlive=off；`isSupported()` 早退泄漏
   - 同一探针 case A 在 base 工作树 `/tmp/herdweb-r4-base`（`3254576`）再跑一遍，输出与 H2 keepAlive=off 逐字段相同
3. 本轮视角最小注入红验（工作树干净 → 只改 `src/controls/mic-controller.ts:749` 判据一行 → 探针断言失败转红 → 只还原该行）：`if (createdEngine)` → `if (false && createdEngine)`。仓内 `tests/mic-controller.test.ts` 全走注入 FakeEngine，**不会**锁住这条生产分叉。
4. OCR 前置：`ocr-review --from 3254576 --to d742ede` 返回 `status=reviewed`（minimax / MiniMax-M3），9 条 finding 的 verifier 全部 `unverified`。下面只采纳经本轮走读/探针核实的条目。
5. `git diff 3254576..d742ede -- build.ts scripts/build-overlay.ts src/asr/worklet-entry.ts src/client-entry.ts src/overlay-entry.ts` 为空；`DEFAULT_WORKLET_URL` 两端都是 `'asr-worklet.js'`。

## OCR 前置对照

| OCR 标注 | 本仓判定 | 两问 | 处置 |
|---|---|---|---|
| createdEngine dispose vs 注入 stop 不对称（low） | 非缺陷 | 生产 `src/index.ts` 从不注入 engine；探针 E：注入路径只 `stop()`、不挂 pagehide | 不采纳 |
| `restartHeldCapture` 早退未登记 `onSamples` 会静默丢 PCM（high） | 不成立 | epoch 失配的 start 本就该丢；engine 回调另有 epoch 闸。提前登记会把过期会话的 PCM 接回去 | 反驳 |
| start-muted 看门狗未闸 `keepAlive`（high） | 非 P1 | 见「keepAlive=off 分叉表」末行：off 路径是 **fail-loud** 而非静默错。规格 1 只要求 **stop** 等价 | backlog（接受） |
| 两谓词重复（medium） | 非缺陷 | 规格 2 明确要求 pause/reuse 两个谓词各答一个问题 | 不采纳 |
| `releaseHeldResources` 先清空字段再 await（medium） | 不成立为新 bug | 单线程下防止二次释放；`start()` 先 await `stopPromise`。R1/R2 已审 | 反驳 |
| 生命周期注释未写 paused 态（medium） | 文档 | 不构成静默错 | backlog |
| `dispose()` 不释放注入 capture（medium） | 非缺陷 | `61cc813` 有意不把 `release` 放进 `PcmCapture`；调用方自有生命周期 | 不采纳 |
| `WorkletLoadError` 顺带拆流（medium） | 已裁决 | R2/R3 backlog：addModule 失败拆流偏保守 | 沿用 backlog |
| `addEventListener` 无存在性守卫（low） | 非缺陷 | 生产是浏览器；H2 测试能构造 keep-alive 引擎 | 不采纳 |

## Findings

### P3-1：`isSupported()` 早退时 keep-alive 构造副作用未释放

- 严重性：P3；置信度：9/10
- 溯源：规格 3（完整释放发生在 dispose / pagehide / 死流重建）。无法把「从未成功创建 controller」的路径升到规格 1/2 的运行时语义，故按纪律不升 P1。
- 本仓 P1 两问：
  1. 真实使用方式下会被触发吗？**基本不会。** 触发条件是 iOS standalone PWA 且 `getUserMedia` 存在、但 `AudioContext` 或 `AudioWorkletNode` 缺失。目标机（现代 iOS 主屏 PWA）两者都在；缺 AudioWorklet 时工具栏本来就不挂语音按钮（`createMicController` 返回 `undefined`，toolbar 跳过 `voice-input`）。
  2. 触发了后果能否接受？**能。** 泄漏的是一次 `pagehide` 监听 + 从未 `start` 过的 engine。监听回调 `release()` 对空 capture 是空操作；真正的 pagehide/卸载仍会跑到它。不是静默无声、不是崩溃、不是数据丢失。
- 位置：`src/controls/mic-controller.ts` 107–114（先 `new DoubaoEngine({ keepAlive: isIosStandalonePwa() })` 再 `if (!engine.isSupported()) return undefined`）；`src/asr/doubao/engine.ts` 164（构造即 `addEventListener('pagehide', …)`）。
- 证据：探针 C5 / C5b（H2）：

  ```
  [PASS] C5.unsupported-createdEngine returns undefined
  { "delta": { "add": 1, "remove": 0 } }

  [FAIL] C5b.unsupported-createdEngine pagehide leak
  { "delta": { "add": 1, "remove": 0 } }
  ```

  对照 C4（正常 dispose 从未录音）：`delta add=1 remove=1`，说明泄漏来自「没有 controller 可 dispose」，不是 release 本身坏了。
- 建议修法（不作为本轮必修）：`isSupported()` 为 false 时对 `createdEngine` 调 `dispose()`，或把 pagehide 注册推迟到第一次成功 `start()`。
- 处置：**接受不修**。不在目标环境触发，且失败模式不是 P1 红线。

## 本轮视角走读

### controller 集成（生产 `createdEngine` 路径）

生产接线在 `src/index.ts:242`：`createMicController({ term, config, hooks, … })` **不注入** engine。keep-alive 唯一生产入口是 `keepAlive: isIosStandalonePwa()`（`mic-controller.ts:110`）。

仓外探针用真实 `DoubaoEngine` + stub 的 `getUserMedia` / `AudioContext` / `WebSocket`，不走测试 FakeEngine：

| 组合 | 结果 |
|---|---|
| C1 录音中 `setTarget` | 进 idle；`gum=1`、`track.stop=0`、`suspend=1`（pause 而非释放）；再点 Mic 复用（仍 `gum=1`、`resume=1`）；dispose 后 `stop=1` 且 pagehide add/remove 成对 |
| C2 `visibilitychange hidden` → cancelSession | 文案「Recording cancelled because the app went into the background.」；流保持；回前台再录复用；dispose 完整释放 |
| C3 停录进 preview → Mic 重录 → composer close | 停录 pause（`stop=0`）；重录 `gum=1`；cancelPreview 仍保持流；dispose 才 `stop=1` |
| C4 从未 start 就 dispose | pagehide 监听构造时 +1、dispose 时 −1 |
| D `navigator.standalone` 未定义 | 构造不注册 pagehide；一次 stop 即 `track.stop=1`、`suspend=0`、`close=1`（与改动前一致） |
| E 注入 `AsrEngine` | dispose 走 `stopEngine()`（`stops=1`），不注册 pagehide |

`cancelSession` / `setTarget` 期间的录音态都只调用 `stopEngine()`（`engine.stop()`）——keep-alive 下这是 pause，符合规格 3「完整释放只在 dispose / pagehide / 死流重建」。preview 确认（`confirmPreview`）不碰采集资源。重录路径是 `preview → idle → startSession`，复用 held capture。

`createdEngine` vs 注入的 dispose 不对称是有意的：注入对象只有 `AsrEngine`（无 `dispose`）。红验把 `if (createdEngine)` 改成 `if (false && createdEngine)` 后，生产路径退化为 `stopEngine()`，C4 从 `remove=1` 变成 `remove=0`（断言失败，不是 ImportError/SyntaxError）。仓内 mic-controller 测试锁不住这条分叉。

### keepAlive=off 逐分叉点核对表

同一探针 case A 在 **base `3254576`** 与 **H2 `d742ede` keepAlive 省略/false** 各跑一次，输出一致：

```
gum=2, stop0=1, stop1=1, contexts=2, closeCalls=2, suspendCalls=0, pagehideDelta add=0 remove=0
```

| 分叉点 | H2 位置 | keepAlive=false 时 | 与 base `3254576` | 证据 |
|---|---|---|---|---|
| 构造注册 pagehide | `engine.ts:164` | 不注册 | base 无监听 | 探针 A 两端 delta 0/0；D `ctorDelta.add=0` |
| start 复用 | `engine.ts:179` | 跳过 | base 每次 gum | 探针 A `gum=2` 两端相同 |
| start 前 `releaseHeldResources` | `engine.ts:183` | stop 后字段已空，空操作 | base 无此行，成功路径同样空 | 探针 A 仍 2 次 gum / 2 次 close |
| stop 的 pause 判定 | `engine.ts:428` | `pause=false` | 清字段、stop tracks、close context | A `stopCalls=1`、`suspend=0` |
| `stopCurrentEpoch` suspend/close | `engine.ts:499-503` | `state !== 'closed'` 才 close | base 无条件 `context.close()`；多一个已 closed 守卫 | A `closeCalls=2` 两端相同 |
| `release()` 卸监听 | `engine.ts:456` | 跳过 | base 无 `release`；controller dispose 多一次空 `release()` | D dispose 后 stop/close 仍为 1，无二次 close |
| `DoubaoEngine` `keepAlive === true` | `engine.ts:564` | 传入 false | 等价于旧 `new BrowserPcmCapture(url)` | A |
| controller dispose | `mic-controller.ts:749` | `dispose()` = `stop()` + 空 `release()` | 旧路径只 `stop()`；idle 时都是空操作 | D |
| `installCaptureSignals` 已 muted 看门狗 | `engine.ts:392` | **未闸 keepAlive** | base 无「构造时已 muted」武装，只听 `onmute` 边沿 | 代码走读（见 backlog） |

规格 1 要求的是「其他环境 **stop** 时行为与改动前完全一致」。上表 stop/close/gum/pagehide 计数在 base 与 H2 off 上逐字段相同。start 路径多出来的「已 muted 则 5s 后 `audio-interrupted`」是 **fail-loud**（旧行为是可能一直无 PCM 且不报错），不构成静默出错，接受为跨平台微小差异。

### 客户端打包 / worklet

- 本 diff 不触及 `build.ts`、`scripts/build-overlay.ts`、`src/asr/worklet-entry.ts`、`src/client-entry.ts`、`src/overlay-entry.ts`。
- `DEFAULT_WORKLET_URL` 仍为 `'asr-worklet.js'`；fresh start 与 `restartHeldCapture` 都 `addModule(this.workletUrl)`，URL 未改。
- worklet 处理器名仍是 `herdweb-pcm-processor`。打包路径不受本改动影响。

## 降层三问

### ① 不可逆动作清单与顺序

| 动作 | 发生点 | 顺序验证 |
|---|---|---|
| `getUserMedia`（占用麦 / 可能弹权） | 仅 fresh start（reuse 谓词失败或残骸清理后） | 探针 C1–C3：controller 多次会话 `gum` 保持 1；D off 路径每次会话 +1 |
| `track.stop()` / `context.close()`（不可逆） | 非 pause 的 stop、`release()`、死流重建前 | C1–C3 pause 期间 0 次；dispose 后恰好各 1 次；D 在第一次 stop 就各 1 次 |
| WS 建连 | engine `start`，先于 capture 复用/gum | 间隙无 socket（停录后 preview 阶段探针未再发 PCM） |
| `context.suspend()` | pause 的 flush 之后 | 可逆（resume）；C1/C2/C3 再 start 时 `resumeCalls≥1` |
| pagehide 监听挂/卸 | 构造（keepAlive）/ `release()` | B、C4 成对；off 路径 A/D 从不挂 |

未发现「终态未完成就先做不可逆动作」的 controller 组合。`setTarget` / 切后台 cancel 都只 pause。

### ② `createdEngine.dispose()` vs 注入 `stop()` 分叉下资源是否各自完整

- **生产 / createdEngine**（`isIosStandalonePwa()===true`）：`dispose()` → `DoubaoEngine.dispose()` → `stop()` + `ownedCapture.release()`。release 卸 pagehide、`releaseHeldResources` 停轨关 context。探针 C1/C2/C3/C4：dispose 后 `track.stop=1` 且 pagehide add/remove 成对。keepAlive=off 时 release 对已 close 的资源是空操作（D）。
- **注入 engine**（测试 seam）：`AsrEngine` 无 `dispose`；controller 只 `stopEngine()`。探针 E：`stops=1`、pagehide 不变。生产 `src/index.ts` 不走这条。
- **缺口**：`!engine.isSupported()` 早退时根本没有 controller，createdEngine 的 pagehide 挂着（P3-1）。不是注入分叉本身不完整。

红验：把 `if (createdEngine)` 改成恒假后，生产路径误走 `stopEngine()`，C4 `pagehide.remove` 从 1 变 0——这条分叉的释放职责确实只在 `createdEngine.dispose()` 上。

### ③ pagehide 注册时机（构造时）与 keepAlive=off 不注册之间有没有遗漏路径

| 路径 | 是否注册 | 是否卸除 |
|---|---|---|
| `keepAlive=true` 构造 | 是（`engine.ts:164`） | `release()` / controller dispose（C4） |
| `keepAlive=false` 构造 | 否 | 无需 |
| 注入 capture / 注入 AsrEngine | 否（ownedCapture 为空 / 不构造 BrowserPcmCapture） | 无需（E） |
| `isSupported()` 早退 | **是**（构造已发生） | **否**（P3-1，已接受） |

没有「应当注册却没注册」的路径：off 平台、注入 seam、非 standalone 都不挂监听。唯一「挂了没卸」是 unsupported 早退。

## 反熵

| 新增抽象 | 第二消费者 | 判定 |
|---|---|---|
| `keepAlive` 选项 | `BrowserPcmCapture` 构造 + `DoubaoEngine` 构造 + `createMicController` | 有 |
| `hasPausableCapture` / `canReuseHeldCapture` | stop 与 start 各一；规格 2 强制拆分 | 有（契约要求，不是无消费者通用化） |
| `ownedCapture` | `dispose()` 与测试注入 capture 隔离 | 有（`61cc813` 的显式决定） |
| `DoubaoEngine.dispose()` | 生产 controller `createdEngine` 路径 | 有；未进 `AsrEngine` 接口（规格 5） |
| `isIosStandalonePwa()` | 生产构造 + `tests/asr-engine.test.ts` 三态 | 有 |
| `restartHeldCapture` / `bindWorkletNode` / `teardownGraph` / `releaseHeldResources` | 均为 `BrowserPcmCapture` 内部私有方法 | 单类私有抽取，不是新公开抽象 |

无「单消费者还硬抽一层」的新增公开接口或用户配置项。

## Backlog / 非本次 findings

- **（本轮 P3-1，接受）** `isSupported()` 早退泄漏 pagehide 监听。目标环境不触发，失败不是 P1 红线。
- **（本轮观察，接受）** `installCaptureSignals` 的「已 muted 武装 5s 看门狗」未闸 `keepAlive`。off 平台若 `getUserMedia` 回来的 track 已经 muted，5s 后 `audio-interrupted`（fail-loud）。规格 1 只锁 stop 等价；旧行为在这条边沿上反而是静默无 PCM。
- **（本轮观察，测试缺口）** 仓内 `tests/mic-controller.test.ts` 一律注入 FakeEngine，锁不住 `createdEngine`+`keepAlive` 生产分叉。本轮用仓外探针 + 红验补了证据；未要求本 PR 补测试（补测试不是 P1）。
- （沿用 R1/R2/R3 已裁决接受）pagehide 与 in-flight start 交错；controller.dispose fire-and-forget；pagehide `void release()` 未 catch；addModule 失败顺带拆流；真机 interrupted 下 `resume()` 若 reject 会误标 `connection-failed`（响亮非静默）；flush 尾部 ~100ms PCM 丢弃（存量）。
- 存量 issue #117 / #118 / #62 与本 PR 无关。

## 验证命令与结果

在 detached H2 `d742ede`：

```
$ pnpm exec vitest run tests/asr-engine.test.ts
 Test Files  1 passed (1)
      Tests  46 passed (46)
   Duration  1.04s (tests 574ms)

$ env -u FORCE_COLOR pnpm test
 Test Files  73 passed (73)
      Tests  1164 passed (1164)
   Duration  9.83s
```

探针（H2）：

```
$ pnpm exec tsx /tmp/keepalive-r4-probe.mts
# 摘要：passed 12 / failed 1（失败项即 P3-1 C5b pagehide leak）
# C1–C4、D、E、A、B、C0 全 PASS
```

探针（base `3254576` @ `/tmp/herdweb-r4-base`）：

```
$ ROOT=/tmp/herdweb-r4-base pnpm exec tsx /tmp/keepalive-r4-probe.mts
[PASS] A.keepAlive-off start-stop-start-stop
  gum=2, stop0=1, stop1=1, closeCalls=2, suspendCalls=0, pagehideDelta {add:0,remove:0}
[PASS] H2-only cases skipped (base tree)
```

H2 A 与 base A 字段一致。

### 红验原文

工作树干净。只改 `src/controls/mic-controller.ts:749`：

```
# 注入前
if (createdEngine) {
# 注入后（sed -n '749p' 确认）
if (false && createdEngine) {
```

探针 C4（本轮视角：createdEngine dispose 才卸 pagehide）转红，类型为断言失败：

```
[FAIL] C4.dispose-never-started unregisters pagehide
{
  "delta": {
    "add": 1,
    "remove": 0
  }
}
```

C1/C2/C3 的 dispose 断言同步转红（`track.stop` 保持 0 / pagehide 未卸），确认注入点落在生产分叉上，不是死代码。只还原该行后 `git diff d742ede` 为空。

`pnpm run check` 在 card 分支写入本 verdict 后跑（仅新增 markdown）。

## 最终 verdict

**pass**

controller 集成面上 setTarget / 切后台 cancel / preview 重录 / dispose 与 keep-alive 引擎的组合均 pause-then-reuse、只在 dispose 完整释放；注入 engine 的 stop-only 分叉与生产 createdEngine 的 dispose 分叉各自完整（红验锁死后者）。keepAlive=off 的 stop/gum/close/pagehide 计数与 base 逐字段相同。worklet URL 与 esbuild 打包路径未改。本轮无新增 P1；P3-1 接受。连续两轮（R3、R4）无新增 P1，按 internal 档收敛条件达标。
