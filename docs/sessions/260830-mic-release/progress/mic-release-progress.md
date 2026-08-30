# mic-release progress

## 2026-08-30 BrowserPcmCapture idle release

当前阶段：implementing（里程碑 ①）

本段结论：`BrowserPcmCapture` 把资源释放拆成 `releaseCaptureResources()`（不停 pagehide 监听），keep-alive 的 `stop()` 在 pause 成功后排 60s 闲置计时器；`start()` / `release()` 入口同步清计时器并推进 `idleGeneration`，避免迟到释放吃掉新会话。轴 1 闲置超时、复用后清计时器、idle 后再 start、pagehide 仍挂钩、keep-alive off 无计时器均有测试。

关键决策与已否决方案：闲置计时器放在 `BrowserPcmCapture` 内（pause 与 held stream 的所有者），不放 DoubaoEngine。否决把 `KEEP_ALIVE_IDLE_MS` 做成可注入配置——测试用 `vi.useFakeTimers`，常量保持模块内 60_000。否决 idle 释放直接调 `release()`（会摘 pagehide）。

下一步唯一动作：跑 `pnpm vitest run tests/asr-engine.test.ts`，绿则提交里程碑 ①，再暴露 `DoubaoEngine.releaseCapture()`。

## 2026-08-30 DoubaoEngine.releaseCapture

当前阶段：implementing（里程碑 ②）

本段结论：`DoubaoEngine.releaseCapture()` 只调 `ownedCapture.releaseCaptureResources()`，engine 可再次 `start()`；pagehide 仍挂钩。注入 capture 的测试路径 `ownedCapture` 为空，方法为空操作。对应测试锁死：pause 后 releaseCapture 轨道 ended，再 start 重新 getUserMedia，随后 pagehide 仍能停新轨道。

关键决策与已否决方案：方法放在具体类、不改 `AsrEngine` 接口。否决在 `releaseCapture` 里走 `dispose()`/`release()`（会摘监听器、语义变成终态）。

下一步唯一动作：提交里程碑 ②，再改 `mic-controller` hidden 分支调用 `releaseCapture()`。

## 2026-08-30 mic-controller hidden 释放采集

当前阶段：implementing（里程碑 ③）

本段结论：`onVisibilityChange` 在 `hidden` 时先按原逻辑取消非 idle 会话，再无条件调用 `createdEngine.releaseCapture()`——idle 且 keep-alive 仍持有 live 轨道时也会释放。`visible` 不申请麦克风、不释放。注入 FakeEngine 的既有路径 `createdEngine` 为空，行为不变。

关键决策与已否决方案：释放调用放在 `currentState !== 'idle'` 守卫之外。否决把释放塞进 `cancelSession`（idle 根本不会进 cancel，主缺陷就在 idle）。

下一步唯一动作：提交里程碑 ③，再同步生命周期迁移表注释并跑 lint。

## 2026-08-30 生命周期注释与 lint

当前阶段：implementing（里程碑 ④）

本段结论：生命周期迁移表已写上 idle timeout / `releaseCapture()` / pagehide 不摘监听的语义。`pnpm run check`、`pnpm run lint:knip`、`pnpm run lint:ox` 三条全绿。测试里空构造函数被 biome 拦下，已删掉。

关键决策与已否决方案：无。

下一步唯一动作：提交里程碑 ④，再做两条红验并跑仓库全量 `pnpm test`。

## 2026-08-30 红验与全量测试

当前阶段：implementing（里程碑收尾）

本段结论：红验 ① 注释 `disposeStartResources` 的 `track.stop()` 后闲置释放测试以 AssertionError（live≠ended）转红；红验 ② 注释 hidden 的 `releaseCapture()` 后 idle hidden 测试以「called 0 times」转红。均已按单行还原。`pnpm test` 76 files / 1315 tests 全绿。

关键决策与已否决方案：无。

下一步唯一动作：无，本卡实现与验证完成，等候验收。
