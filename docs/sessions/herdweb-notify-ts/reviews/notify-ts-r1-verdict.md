# notify-ts-r1 H0 Verdict

## 结论

**PASS：H0 可合入。** 审查对象严格固定为 `19f1c7101515070d21257b8ad0122cd62598ba30..d0a9b1086ededf6739c77e4e1712b8e047068f29`；未审查该范围之后的提交。按 `personal` 风险等级，没有发现数据丢失、静默出错或崩溃型 P1。

## DESIGN-note 不变式核验

| 不变式 | 结论 | 证据 |
|---|---|---|
| 1. Unix 秒进不了库 | PASS | `src/notify/events.ts:157-162` 先拒绝非有限值，再对 `ts < NOTIFY_TS_MIN_MS` 抛 400；`src/notify/routes.ts:150-169` 在 `dispatchEvent` 前完成解析，因此失败请求不会进入服务或写盘。`tests/notify-events.test.ts:195-209` 覆盖秒级/低于下界，`:318-339` 覆盖 HTTP 400、无 `events.jsonl`。 |
| 2. 真毫秒仍 202 | PASS | 下界是严格小于判断，`1_000_000_000_000` 在 `tests/notify-events.test.ts:211-215` 被解析接受；HTTP 的 `Date.now()` 样本在 `:341-358` 返回 202 并断言原值写入。 |
| 3. 文档与实现一致 | PASS | `docs/configuration.md:421-425` 明确说明低于 `1_000_000_000_000` 返回 400 且不存储；固定 H0 树的 `docs/configuration.md` 不再命中 `does not range-check`。 |

## 高风险失败路径

- 秒级 HTTP 请求：解析器在持久化前抛 `NotifyEventError(400)`，路由只记录拒绝并返回 400，不调用 `dispatchEvent`；测试同时断言无事件文件。
- 真毫秒 HTTP 请求：`Date.now()` 样本返回 202 且 `events.jsonl` 中的 `ts` 与请求值一致。
- 秒转毫秒兼容分支：未发现。H0 中没有 `ts` 的乘除换算或数量级启发式；`parseNotifyEvent` 原样保存通过下界的 `obj.ts`。
- 非目标字段：`startedAt`、`presenceAt` 未增加下界；历史读取仍只做既有结构校验，没有回写或订正旧秒级事件，符合 DESIGN-note 非目标。
- 熵审查：新增常量有解析器和测试两个消费者；未新增 fallback、重试、状态或包装层。

## Findings

无 P1、P2 或 P3 finding。没有需要阻塞合入的修复项。

## 审查证据

- `git diff --check base..H0`：通过。
- 卡面提供的外部证据：`env -u NO_COLOR pnpm test` 为 78 files / 1360 tests 全绿；主脑已完成相关红验，证明删除下界判断后秒级 parse 与 HTTP 断言均失败。
- 本轮独立 OCR 前置扫描：`status=skipped`，主腿及 qwen/glm 备腿均为 `caller_error:startup_stderr`；这不是“扫描通过”，但不影响本次基于代码、测试与入口链的完整审查。
