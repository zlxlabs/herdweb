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

## 2026-08-31 NOTIFY_TS_MIN_MS lower bound

当前阶段：implementing（第 3 笔：下界实现）

本段结论：`src/notify/events.ts` 导出 `NOTIFY_TS_MIN_MS = 1_000_000_000_000`，在 finite number 检查之后、返回前拒绝 `ts < NOTIFY_TS_MIN_MS`，文案 `ts must be epoch milliseconds`。新加的秒级/边界/`Date.now()` 用例已绿。喂给解析器的既有秒级假数据（`validBase.ts = 1_700_000_000`、`ts: 1` HTTP body、patrol 秒级样本）按预期转红，共 31 failed / 42 passed。

关键决策与已否决方案：不做秒→毫秒启发式。测试改为 import 该常量作为第二消费者。startedAt / presenceAt 不加下界。

下一步唯一动作：把喂给 `parseNotifyEvent` 的假数据改成 `1_700_000_000_000`，并改 `docs/configuration.md` 删掉 Ingress does not range-check。

## 2026-08-31 millisecond fixtures and docs

当前阶段：implementing（第 4 笔：假数据与 configuration.md）

本段结论：喂给 `parseNotifyEvent` 的秒级/占位 `ts` 改为 `1_700_000_000_000`（本文件内统一该风格）。patrol 样本 `ts` 改为毫秒，id 仍保留实测秒级字符串。直传 `NotifyEvent`（`dispatchEvent`、面板 history mock、健康检查相对时钟、`buildNotifyContent`、service worker helpers、attention-policy `BASE`）未改。`docs/configuration.md` Local events API 改为 ingress 会对低于 1e12 的 `ts` 返回 400。

关键决策与已否决方案：不改 `startedAt` / `presenceAt` 下界。不订正库存。不为 knip 加假 import。

下一步唯一动作：跑 `pnpm test tests/notify-events.test.ts`，绿则跑全量 `pnpm test`、`pnpm exec tsc --noEmit`、`pnpm run check`，再做红验（只删 `ts < NOTIFY_TS_MIN_MS` 判断那一行）。

## 2026-08-31 红验与收尾

当前阶段：implementing（收尾）

本段结论：红验只删 `if (obj.ts < NOTIFY_TS_MIN_MS)` 判断块后，秒级 parse 三条与 HTTP 400 一条均以 AssertionError 转红（parse 不再抛 NotifyEventError；HTTP 收到 202）。已单行还原。`pnpm exec tsc --noEmit` 与 `pnpm run check` 退出码 0。`rg -n "does not range-check" docs/configuration.md` 退出码 1。本会话环境同时设置 `NO_COLOR=1` 与 `FORCE_COLOR=1`，裸 `pnpm test` 会让 `cli-config-validation` 因 Node 警告污染 stderr 红一条；`env -u NO_COLOR pnpm test` 78 files / 1360 tests 全绿。未改该测试文件，未跑 Playwright。

关键决策与已否决方案：无新增抽象。否决入口启发式换算。

下一步唯一动作：无，本卡实现与验证完成，等候验收。
