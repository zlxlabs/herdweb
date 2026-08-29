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

### P2：2 条，建议修但不阻塞本轮 P1 判定

- P2-1（建议修）：`src/notify/service.ts:403-405` 用“当前事件不是 fresh `likely-present`”作为 flush 条件，导致同 session 的无 `presence` 普通事件也立即释放 pending。违反 issue #124 规定的提前补发触发集合（`likely-away` / `unknown` / 陈旧 `presenceAt`）；可选字段的无 presence 事件应继续按现有规则处理，不应自动表示离场。独立探针输出为 `sent:["present","no-presence"]`，而探针期望 pending 保持。后果是提前出站而非丢失，建议只在显式离场/陈旧信号时调用 `flushDeferredPresenceFor`。
- P2-2（建议修）：`src/controls/notify-panel.ts:448-470` 不串行化 away-mode PUT；快速 on→off→on 时，服务端按请求到达顺序持久化和在 on 时 flush，但面板按响应到达顺序写 `awayModeServer`，可与 `notify-settings.json` 不一致。违反“一个跨设备共享的运行时状态、每次打开读新状态”的状态一致性不变式；建议禁用 toggle 直到当前 PUT 结束，或采用显式版本/重新 GET。它不造成事件丢失，个人实际操作下后果可接受，故不升 P1。

### P3：2 条，接受不修

- P3-1（接受不修）：`src/notify/events.ts:178-180,212` 对合法 `presence` 做两次无副作用校验。违反本仓反熵纪律中“没有必要的重复工作应删减”的要求，但每次解析只多一次三项数组扫描，不影响行为、可靠性或用户语义；后续整理时可缓存值。
- P3-2（接受不修）：`src/controls/notify-panel.ts:287-298,458-465` 在首次 settings GET 失败后仍允许 PUT，失败回滚可能回到初始 `false`，使当前面板短暂显示未知的服务端状态。违反“面板开关应反映运行时状态”的软不变式，但 GET 会在下次打开重试，且没有改错服务端文件或丢事件；本轮不增加状态/重试机制。

### 外部工具严重度重新分诊

OCR 的 `high/medium/low` 只是输入，不直接等于本仓级别：

| OCR finding | 本仓判定 | 两问/处置 |
|---|---|---|
| 双队列同 key 覆盖、事件无日志丢失（high） | P1 | 真实可触发；后果不可接受；必须修，见 P1-1 |
| 无 presence 也 flush（未由 OCR 报出） | P2 | 真实可触发；提前而非丢失；建议修，见 P2-1 |
| PUT 并发响应乱序、初次 GET 失败回滚（medium） | P2/P3 | 真实可触发；仅面板状态暂时错误且可重开恢复；分别建议修/接受不修 |
| GET 未做 Origin 检查（low） | 非 finding | GET 无副作用且不泄露敏感数据；锁定契约只要求 PUT 同源，不能反着契约报错 |

每条意见均已溯源至 issue #124 的字段/闸/开关契约或本仓反熵纪律；无法溯源的纯风格建议不阻塞。

## 降层三问、事件丢失穷举、熵增审查与实测证据

待第三阶段补入。
