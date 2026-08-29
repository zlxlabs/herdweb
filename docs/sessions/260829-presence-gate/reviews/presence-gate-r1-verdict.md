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

## 降层三问

1. **终态写入成功前的不可逆动作**：普通事件先在 `dispatchEvent` 中 `dedup.add` 并 append `events.jsonl`，再进入闸；presence timer/flush 回调先从 `pendingPresence` 删除，release 的 `queueCoalesce` 还会先清掉同 key 的旧 timer/map entry，再开始 Web Push 或 webhook POST。`writeNotifySettings` 则先原子 rename，成功后才 flush。没有一份按事件维度的出站成功账本；P1 正是旧 coalesce entry 已被删除后，外部 POST 尚未发生就失去引用。
2. **守卫值是否自身唯一**：`event.id` 的 dedup key 含 target id，但 `coalesceSessionKey` 只有 `session ?? 'default'`，在多 target/同名 session 部署中并不全局唯一；这是锁定决策明确保留的既有缺陷。本轮新增问题不是重复报告该缺陷，而是把同一个非唯一 key 同时用于两个可并存的队列，造成跨队列覆盖。`presenceAt` 是时间戳，不是唯一身份，只用于新鲜度，不能承担账本 key。
3. **保护的是写入还是行为**：输入解析、JSON settings 写入和队列 map 写入都有保护；真正的出站行为没有覆盖式保护。`queueCoalesce` 只保护“当前 map 最后一条”，不保护被另一条队列 release 覆盖的旧事件是否已 POST；`awaitInFlight` 只等待当时仍在 `inFlight` 的 promise。因此防线覆盖了中间状态写入，没有覆盖终态 Web Push/webhook 行为。

## 事件丢失穷举

“最终发出”按 Web Push/channel 出站调用是否启动判定；silence/child-done 若从未进入 pendingPresence，按锁定闸规则“不出站”不是丢失。

| pendingPresence 路径 | 事件最终发出了吗 / 谁保证 | 哪个测试锁死 |
|---|---|---|
| 300s 定时器到期 | asking/health/ci-red/root done 由 timer 删除 pending 后 `releaseDeferred` 直接 `deliverOutbound`，会发；无 role done 先入 600s coalesce，再由第二个 timer 发。 | `notify-attention-policy.test.ts`: `likely-present asking writes history...`、`an unlabeled likely-present done defers...` |
| 同 key 新 fresh `likely-present` 替换 | 旧条目按锁定“每桶只留最后一条”不发，新条目重置 timer 并发；旧事件仍在 history。 | `notify-attention-policy.test.ts`: `a fresh likely-present event on the same session resets...` |
| 同 key `likely-away` / `unknown` / 陈旧 `presenceAt` | `flushDeferredPresenceFor` 先删除旧 pending，再 release 旧事件，之后当前事件走现有规则；两条都应发（若当前是 silence/child 则当前按规则不发）。 | `notify-attention-policy.test.ts`: `a likely-away event...`、`a stale presenceAt...` |
| `flushDeferredPresenceFor` | 同上；同 session 的旧 pending 有直接保证。跨 session 不释放是已登记 backlog，不重复报告。 | 同上两项；没有跨 session 断言，符合已登记 backlog |
| `flushAllDeferredPresence` / away mode=true | 正常时逐 key release，asking/root 直接发，unlabeled done 进 coalesce；路由写 settings 成功后同步调用 flush。若同 key 已有 pendingCoalesce，触发 P1-1 覆盖，旧事件不发。 | `notify-settings.test.ts`: `PUT awayMode=true flushes...`；`notify-service-drain.test.ts` 只覆盖无 collision |
| `awaitInFlight` | 先 `flushAllDeferredPresence`，再 `flushAllCoalesced`，所以 release 新建的 coalesce 会被排空；但旧同 key entry 可能已被覆盖，P1-1 仍丢。 | `notify-service-drain.test.ts`: `awaitInFlight flushes a pending presence-deferred event...`、`dispose flushes a deferred unlabeled done through both queues` |
| `dispose` | 它按相同顺序启动所有出站，但返回 `void` 不等待；真实 `serve` 先 `notifyDrain` 再 dispose，因此正常关停由 drain 保证。直接调用 dispose 后立即退出进程不具备独立保证；这与既有 coalesce dispose 语义一致，本轮接受。 | `notify-service-drain.test.ts`: `dispose flushes...` 两项；测试随后显式 await，未锁死“dispose 返回即完成” |
| 正常 SIGTERM | `serve` 的 SIGTERM handler 关闭 listener/lifecycle，等 session，再 `notifyDrain`（两次 flush + 等 inFlight），最后 dispose；正常在 10s drain 超时内会启动并等待出站。没有专门 SIGTERM 测试；SIGKILL/外部强杀不在本卡语义内。 | `src/serve.ts:1025-1069` 生命周期代码；本轮没有直接 SIGTERM 回归测试 |
| release 再进 coalesce 后排空 | 无 collision 时会被后续 `flushAllCoalesced` 或 600s timer 发；有 collision 时 `queueCoalesce` 的覆盖使旧 entry 无发送/无日志，违反不变式，是 P1-1。 | `notify-service-drain.test.ts` 的 `...through both queues` 只证明新 entry 被排空，未覆盖已有同 key entry；缺失测试正是 P1 证据 |

## 熵增审查：每个新增符号的第二消费者

| 新增抽象/状态/导出 | 第二消费者与结论 |
|---|---|
| `NotifyPresence`、`presence`/`presenceAt` 字段 | 事件解析/历史序列化与出站策略各消费；是边界契约所需，不是熵增 |
| `PRESENCE_FRESH_MS` | freshness predicate 与测试消费；作为事件契约常量集中导出，必要 |
| `isNotifyPresence` | 解析校验和 optional 归一化各调用一次，但第二次是重复扫描；P3-1 接受不修 |
| `PRESENCE_DEFER_MS`、`OutboundDecision: defer` | 策略定义与 service 定时器/测试消费；分别连接策略和执行层，必要 |
| `isFreshLikelyPresent` | `decideOutbound` 与 `dispatchEvent` 的 flush guard 消费；两个不同行为点需要同一判定，必要 |
| `pendingPresence`、`awayMode()`、`releaseDeferred` | timer、per-key flush、global flush、drain/dispose 均消费；状态确有多条生命周期路径，必要 |
| `queuePresenceDefer`、`flushDeferredPresenceFor`、`flushAllDeferredPresence` | dispatch、timer、settings route、drain/dispose 分别消费；不是单调用方包装层，但与 `pendingCoalesce` 共 key 的设计缺陷见 P1-1 |
| `NotifyService.flushDeferredPresence` | settings PUT 路由调用，service 实现与 settings/drain 测试验证；跨模块边界必要 |
| `NotifySettings`、`NOTIFY_SETTINGS_FILE`、`readNotifySettings`、`writeNotifySettings` | state 读写与 route/serve wiring 消费；运行时跨请求、跨设备状态需要持久化，必要 |
| `isAwayMode` service dependency | `serve` 绑定真实文件，测试注入可控状态；是已有 service factory 的最小依赖注入，不是无消费者抽象 |
| `/api/notify/settings` GET/PUT 两路由 | 面板 GET/PUT 是真实消费者，HTTP 测试是契约消费者；不是孤立接口。GET 不做 Origin 检查不是 finding，PUT 已按锁定契约同源校验 |
| away-mode 面板节点、`awayModeServer` | open 的读取、change 的提交/失败回滚各消费；UI 状态必要，但并发一致性缺 guard，见 P2-2 |

没有新增 fallback、重试、防御式 catch 或另一套并行出站机制。P1 修复应优先消除双队列同 key 覆盖，不应为 P2/P3 再增加状态层。

## 实测证据

### H0 与固定范围

```text
$ git rev-parse HEAD
352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
$ git rev-parse 352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
$ git diff --stat c101d651d652c3ac67adf5f23aa4701f1b090aae..352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
17 files changed, 1099 insertions(+), 17 deletions(-)
```

### 类型检查、指定测试、空白检查

```text
$ pnpm exec tsc --noEmit
✓ Lockfile passes supply-chain policies (verified 6d ago)
Lockfile is up to date, resolution step is skipped
Progress: resolved 492, reused 492, downloaded 0, added 492, done
Done in 1.5s using pnpm v11.7.0
exit 0

$ pnpm exec vitest run tests/notify-attention-policy.test.ts tests/notify-events.test.ts tests/notify-decision-log.test.ts tests/notify-service-drain.test.ts tests/notify-state.test.ts tests/notify-panel.test.ts tests/notify-settings.test.ts
Test Files  7 passed (7)
Tests  178 passed (178)
Duration  1.92s (transform 520ms, setup 0ms, collect 1.49s, tests 1.73s, environment 1.24s, prepare 606ms)
exit 0

$ git diff --check c101d651d652c3ac67adf5f23aa4701f1b090aae..352a7bcaa09ee2bd1f4cb6c64d7dfc133d3a6d44
(no output)
exit 0
```

### 运行时探针与红验

同 session 双队列 collision 探针实际输出：

```text
herdweb: notify decision skipped kind=done id=already-coalesced reason=done-coalesced
herdweb: notify decision skipped kind=done id=presence-deferred reason=user-present
herdweb: notify decision skipped kind=done id=presence-deferred reason=done-coalesced
herdweb: notify decision accepted kind=done id=presence-deferred
{"sent":["presence-deferred"],"expectedNoLoss":["already-coalesced","presence-deferred"]}
```

无 presence 提前 flush 探针实际输出：

```text
herdweb: notify decision skipped kind=asking id=present reason=user-present
herdweb: notify decision accepted kind=asking id=present
herdweb: notify decision accepted kind=asking id=no-presence
{"sent":["present","no-presence"],"pendingShouldRemain":true}
```

第三注入点红验：先 `grep -n -C1 RED-VERIFY src/notify/service.ts` 确认注入于 `releaseDeferred` 的 coalesce 分支，随后目标测试原始失败输出为：

```text
FAIL ... tests/notify-attention-policy.test.ts > presence defer lane (service) > an unlabeled likely-present done defers, then enters the 600s coalesce window
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
❯ tests/notify-attention-policy.test.ts:537:26
535|   vi.advanceTimersByTime(PRESENCE_DEFER_MS)
536|   await Promise.resolve()
537|   expect(h.sendPush).not.toHaveBeenCalled()
```

还原后的实际输出：

```text
service restored
```

随后 `git diff -- src/notify/service.ts` 为空，`git status --porcelain` 无输出。

### OCR 与 graphify

OCR 原始 envelope 的关键字段：`status=reviewed`、`profile=minimax`、`model=MiniMax-M3`、`cli_status=complete`、`coverage=complete`；共 13 条，`confirmed=9`、`refuted=2`、`unverified=2`。OCR 的双队列覆盖意见经上述独立探针确认并升为本仓 P1；其 GET Origin 意见按锁定契约驳回，低收益重复校验按 P3 处理。

graphify 完整语料因本机无 LLM API key 明确失败；按技能规则改走 `--code-only`，实际生成 2028 nodes、4343 edges、104 communities，查询确认 `notify-service`、`attention-policy`、`events`、面板及 drain 测试的调用关系。该工具结果只作关系定位，不替代上述源码与运行时证据。
