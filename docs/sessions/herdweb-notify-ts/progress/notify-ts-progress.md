# notify-ts progress

## 2026-08-31 design lock

当前阶段：implementing（第 1 笔：design.md）

本段结论：已把卡面拍板的 DESIGN-note 原文写入 `docs/sessions/herdweb-notify-ts/design.md`。下界是 `ts < 1_000_000_000_000` 则 400（含等接受），只锁 `ts`。

关键决策与已否决方案：下界 1e12 含等。否决入口启发式把秒换成毫秒；否决现在就关 #129 不加校验；否决改面板显示来「看起来像对的」。

下一步唯一动作：写会红的秒级/边界/`Date.now()` 测试到 `tests/notify-events.test.ts`，先确认断言失败再实现下界。
