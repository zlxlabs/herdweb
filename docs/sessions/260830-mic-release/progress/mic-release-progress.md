# mic-release progress

## 2026-08-30 BrowserPcmCapture idle release

当前阶段：implementing（里程碑 ①）

本段结论：`BrowserPcmCapture` 把资源释放拆成 `releaseCaptureResources()`（不停 pagehide 监听），keep-alive 的 `stop()` 在 pause 成功后排 60s 闲置计时器；`start()` / `release()` 入口同步清计时器并推进 `idleGeneration`，避免迟到释放吃掉新会话。轴 1 闲置超时、复用后清计时器、idle 后再 start、pagehide 仍挂钩、keep-alive off 无计时器均有测试。

关键决策与已否决方案：闲置计时器放在 `BrowserPcmCapture` 内（pause 与 held stream 的所有者），不放 DoubaoEngine。否决把 `KEEP_ALIVE_IDLE_MS` 做成可注入配置——测试用 `vi.useFakeTimers`，常量保持模块内 60_000。否决 idle 释放直接调 `release()`（会摘 pagehide）。

下一步唯一动作：跑 `pnpm vitest run tests/asr-engine.test.ts`，绿则提交里程碑 ①，再暴露 `DoubaoEngine.releaseCapture()`。
