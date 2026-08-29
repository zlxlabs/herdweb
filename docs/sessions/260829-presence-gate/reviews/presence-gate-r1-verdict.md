# Presence 出站闸与离场模式开关：R1 审查结论

## 结论

- risk-tier: personal（本 diff 核心涉及失败路径、状态迁移、定时器队列与关停排空，按 infra/状态机例外提档到 internal 档执行）
- verdict: fail
- review-range: c101d651d652c3ac67adf5f23aa4701f1b090aae..352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
- H0: `git rev-parse HEAD` 与 H0 均为 `352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44`。

本轮是独立 R1；新证据为：固定范围全量 diff 与 issue #124 契约的重新核对、指定测试/类型检查/diff-check 的新输出、同 session 双队列运行时探针、第三注入点红验，以及 OCR 前置扫描。只审上述固定提交范围；新提交不改变本 verdict。

## P1：1 条，必须修

### P1-1：presence release 会静默覆盖同 session 已有的 done-coalesce，丢失一个出站事件

- 位置：`src/notify/service.ts:157-164,334-336`；排空顺序在 `:371-377` 后接 `:309-315`。
- 违反不变式/契约：已接受事件必须最终出站或被明确的同一合并语义替代并可归因；issue #124 锁定“presence 队列按 `coalesceSessionKey` 每桶只留最后一条”，并要求 release 后沿用 done-coalesce 语义。当前 `pendingPresence` 与 `pendingCoalesce` 可同时占用同一 key，release 只调用会无条件覆盖 map entry 的 `queueCoalesce`，被覆盖事件没有发送、没有 skip 日志。
- 真实路径：同一 `session=dev` 先来无 presence 的 unlabeled `done`，进入 `pendingCoalesce`；随后来 fresh `likely-present` 的 unlabeled `done`，进入 `pendingPresence`；定时器、`flushDeferredPresenceFor`、`flushAllDeferredPresence`、`awaitInFlight` 或 `dispose` release 后，再次进入同一 `pendingCoalesce` bucket，旧事件被 `clearTimeout` + `set` 静默丢掉。若 release 事件的 `ts` 更旧，结果还会反向覆盖更新事件。
- P1 两问：
  1. 本项目真实使用方式会触发吗？会。presence 是可选字段，旧生产者/既有无 role done 仍合法；同一 session 的 done-coalesce 与新 presence 事件可以交错到达，且本服务确实支持两种输入。
  2. 后果能接受吗？不能。事件已写入 `events.jsonl` 却永远没有 Web Push/channel 出站，且日志没有记录替代关系；这是个人档明确的事件丢失/静默错误。
- 独立复现实际输出：

  ```text
  herdweb: notify decision skipped kind=done id=already-coalesced reason=done-coalesced
  herdweb: notify decision skipped kind=done id=presence-deferred reason=user-present
  herdweb: notify decision skipped kind=done id=presence-deferred reason=done-coalesced
  herdweb: notify decision accepted kind=done id=presence-deferred
  {"sent":["presence-deferred"],"expectedNoLoss":["already-coalesced","presence-deferred"]}
  ```

  该探针在 `dispose()` 中走“presence flush → coalesce flush”，仍只发出后者；说明顺序本身保证了“新建的 coalesce 会被再排空”，但没有保证原先同 key 的 coalesce 不被覆盖。

## P2/P3

待第二阶段补入，包含每条意见的“建议修/接受不修”、理由及契约溯源。

## 降层三问、事件丢失穷举、熵增审查与实测证据

待第三阶段补入。
