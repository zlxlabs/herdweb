# notify-ts progress

## 2026-08-31 design lock

当前阶段：implementing（第 1 笔：design.md）

本段结论：已把卡面拍板的 DESIGN-note 原文写入 `docs/sessions/herdweb-notify-ts/design.md`。下界是 `ts < 1_000_000_000_000` 则 400（含等接受），只锁 `ts`。

关键决策与已否决方案：下界 1e12 含等。否决入口启发式把秒换成毫秒；否决现在就关 #129 不加校验；否决改面板显示来「看起来像对的」。

下一步唯一动作：写会红的秒级/边界/`Date.now()` 测试到 `tests/notify-events.test.ts`，先确认断言失败再实现下界。

## 2026-08-31 failing ingress tests

当前阶段：implementing（第 2 笔：先红的新测试）

本段结论：`tests/notify-events.test.ts` 新增秒级样本 `1_788_090_200`、`ts=1`、`999_999_999_999` 的 parse 400，HTTP POST 同样 400 且不入库；边界 `1_000_000_000_000` 与 `Date.now()` 接受。`pnpm test tests/notify-events.test.ts`：4 failed / 69 passed。失败类型是断言失败（parse 三条因秒级被接受而 `expected throw`；HTTP 一条 `expected 202 to be 400`）。

关键决策与已否决方案：测试先用字面量锁死轴表数值，不在本笔 import 尚未存在的 `NOTIFY_TS_MIN_MS`。非有限 `ts` 用例在本笔已绿（既有 finite-number 检查）。

下一步唯一动作：在 `parseNotifyEvent` 导出 `NOTIFY_TS_MIN_MS` 并在 finite 检查之后拒绝 `ts < NOTIFY_TS_MIN_MS`。
