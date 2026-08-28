# 通知判决日志 R1 verdict

- 审查范围：`f7488c83df9bea1f581ef7ce4cbaf3987ff5251f..b9ce998ec96bf5d5dbd9c1dd9fbe900604ec4be9`（H0=`b9ce998ec96bf5d5dbd9c1dd9fbe900604ec4be9`）
- risk-tier: personal
- verdict: pass
- 判定依据：无 P1；P2 均接受不修，不阻塞本轮。审查未使用实现方 `report.md`。

## P1

- 无。个人项目 P1 红线为数据丢失、静默出错、崩溃；以下意见逐条回答两问后均未达到 P1。

## P2（接受不修）

### P2-1：合法 `silence` 直 dispatch 没有 accepted 判决行

- 位置/证据：`src/notify/service.ts:265-267` 排除 `silence`；`parseNotifyEvent` 与 `/api/events` 仍接受并 dispatch `kind=silence`。运行探针得到 `result=accepted` 且 channel delivered，但无 `herdweb: notify decision accepted`。
- 契约溯源：总契约“每次发出留下同一套现场”，spec 1、2；正常静默检测器在 `src/notify/silence.ts:105-112` 自行记录，故只漏公共直 dispatch 路径。
- P1 两问：真实使用会触发吗？会，loopback events API 接受该 kind；后果能接受吗？能，通知仍发出，仅缺审计行，无数据丢失/错误结果/崩溃，故降为 P2。

### P2-2：入站 `id` 未做日志字段约束，可把 `?key=` 或换行带入 console

- 位置/证据：`src/notify/decision-log.ts:56-58` 原样插入 `kind/id`；`parseNotifyEvent` 允许任意非空字符串 id。合法事件 `id=?key=secret` 的运行探针输出了 `herdweb: notify decision accepted kind=done id=?key=secret`。
- 契约溯源：spec 4 要求任何 console 不出现 `?key=`，spec 9 禁止 raw inbound body 进入日志；本项不是通道 URL 泄漏，但破坏了日志安全边界/单行可 grep 约束。
- P1 两问：真实使用会触发吗？仅在同机 loopback producer 主动使用 URL/含换行 id 时会触发；后果能接受吗？不能视为完全可接受，但该输入由受信本机来源控制且不改变通知结果，未达 personal P1，故为 P2。

### P2-3：`getConnInfo` 异常被收成 403，改变原有失败语义

- 位置/证据：`src/notify/routes.ts:42-49`；无 Node 连接上下文调用 `getConnInfo` 的探针原本得到 500/TypeError，当前 catch 会把同类事件判为 `not-loopback` 403。
- 契约溯源：spec 7 要求不改发出规则；卡面明确要求复核“无连接信息从 500 收成 403 是否引入静默拒收”。
- P1 两问：真实生产入口会触发吗？目前证据否，正常 `@hono/node-server` socket 有连接信息，探针只覆盖 app.fetch/非 Node adapter；后果能接受吗？是 fail-closed 的显式 403 且有拒绝日志，不会静默放行/误发，故不属 P1，接受为 P2。

## P3

- 无新增契约缺陷。`src/notify/routes.ts:168-172` 的 duplicate 分支与 fallthrough 都返回 202；满足 spec 8 的“不二次 append、仍 202”，仅属冗余实现。

## 其他不变式与证据

- `pnpm exec vitest run` 六个通知测试文件：96 passed；`git diff --check` 通过。
- 通道日志统一含 `kind=`、`id=`，只用 host；WeCom 2xx + 非零数字 `errcode` 记 `failed`，未见 `?key=` 通道 URL。
- `shouldAnnounceRestart` 仍为纯函数；未见沉默阈值、冷却、120 秒窗口、去重容量、`events.jsonl` schema 或通道 payload 被改动。
- OCR 前置扫描实际执行但三条腿均 `status=skipped`（`caller_error:usage_help`），不作为干净证据。
