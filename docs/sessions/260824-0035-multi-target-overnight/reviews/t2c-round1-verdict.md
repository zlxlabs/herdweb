# T2c round 1 verdict

固定 H0：`09f862ab85e8773d29d5c91f9d5ffcbdde87e420..e6d9a987eedc1a3dec0afe67d2dec45a90f815f5`；P1 数量：0；是否 clean：是。红验证据：base 只注入 H0 的 `tests/session.test.ts` 与 `tests/serve.test.ts` 新增测试，grep 已确认注入；base 定向测试为 5 failed/39 passed，分别因缺少 `enqueueMirrorWrite` 与 `createSessionClient` 变红。H0 定向测试为 2 files/44 tests 全绿。

## 新证据与边界

- OCR 前置扫描为 `status=reviewed`、MiniMax-M3，6 条候选；不是 skipped。
- H0 临时副本把 WS `>` 改为 `>=`，grep 命中后 `tests/serve.test.ts` 为 1 failed/28 passed；把 UTF-8 `Buffer.byteLength` 改为 `payload.length`，命中后为 2 failed/27 passed。新增测试约束力成立。
- `src/serve.ts:600-614` 的生产 `onOpen` 实际调用 `createSessionClient(raw)`；测试捕获 `raw.send` 的最终序列化字符串。重复 fan-out probe：slow raw close `[1013,"slow-client"]` 一次、无 send；healthy sibling 收到同一字符串两次、未 close。`onClose` 只移除当前 binding（`src/serve.ts:649-657`）。
- Playwright 的 76 pass/7 skip/3 个导航或 teardown 超时没有本 diff 的真实入口因果证据；现有服务端定向测试全绿，故不升 P1、不阻塞。

## mirror 状态矩阵

| 状态 | pendingMirrorBytes / mirrorPaused | 大字符串 | PTY 后果 |
|---|---|---|---|
| 写入尚未开始 | `1 MiB / true`（两块 512 KiB 入账） | Promise 链仍持有 | 已 pause 一次 |
| write 已开始、callback 未回 | `1 MiB / true` | 当前块和后续块仍持有 | 不 resume |
| callback 正常回 | 首回 `512 KiB / true`，再回 `0 / false` | 随链推进释放 | 严格低于 512 KiB 才 resume 一次 |
| mirror.write 同步 throw | `1 MiB / false`，`terminalFailed=true` | 链 settle 后释放；只残留 number | `failTerminal()` 已 resume；后续不再入队 |
| `terminalFailed` 已置位再入队 | 仍为 `1 MiB / false` | 不新增持有 | enqueue 直接 return，不再碰 PTY |
| dispose | 先 resume、清 `mirrorPaused`，再 kill/await exit | callback 未回前仍由链持有 | late callback 不会再 resume 已 kill PTY；probe 最终 `0 / false` |
| PTY natural exit | 若此前 paused，`onExit` 不清 paused；probe 为 `1 MiB / true` | callback 未回前仍持有 | drain 后会对已 exited PTY 调一次 resume；实际 probe 未抛错，记 P2 |

## OCR 逐条裁决

- 并发 `bufferedAmount` race：工具标注 high；本仓判定不成立、P3。P1 两问：真实使用中 `broadcast` 同步逐 binding 调用，`ws` 的 buffered 账本同步反映 send，故不会触发所称窗口；后果问题不存在。
- `terminalFailed` 后 bytes 未扣：工具标注 high；本仓判定 P2、接受不修。P1 两问：会真实残留一个死 number，但失败后 enqueue 直接 return，不会造成真实内存无界、永久 pause、崩溃或静默结果错误；session 已 fail-loud 关闭客户端，后果可接受。
- “小块永不触发高水位”：工具标注 high；本仓判定 refuted、P3。P1 两问：每次 enqueue 都先累计共享 bytes，连续小块达到 1 MiB 会 pause；所称路径不存在。
- dispose 未 await、callback 会在 kill 后 resume：工具标注 high；本仓判定 refuted、P3。P1 两问：dispose 先清 `mirrorPaused`，callback guard 不会再调用 resume；probe 验证 kill 后 resume 计数不增加。
- cleanup 重置 bytes 为 0：工具标注 high；本仓判定 P2 建议无效。P1 两问：若 fail/dispose 时仍有正常 callback，后续扣减会下溢；probe 的 dispose-before-callback 正是可见反例，不能照搬 reset/defensive await。
- 注释、重复 threshold、缺 mirror 不变式注释：工具标注 low；本仓判定 P3 backlog。P1 两问：只影响可维护性，不会在当前入口触发用户故障；后果可接受。

## P2/P3 backlog 与熵增

- P2：失败后 `pendingMirrorBytes` 是死账；未来若要清理，必须先锁定“fail 后 callback/queue drain”而非盲目归零。P2：natural exit 的晚 callback 可 resume 已 exited PTY；当前 node-pty probe 未抛错，且不违反本轮明文的 failure/dispose paused 不变式。
- P3：为 `createSessionClient` 导出 factory。生产消费者只有 `src/serve.ts:610`，测试是唯一第二调用方；它提供了确定性 raw.send/UTF-8 seam，合理但有轻微熵增。无需为 P2/P3 扩大抽象或改成通用背压框架。
- P3：生产常量与测试重复、背压不变式注释缺失；接受不修，不阻塞。

## 不变式与锁定位置

- mirror 高/低水位及 UTF-8 账本在 `src/session.ts:279-303`；正常阈值、失败恢复、dispose 恢复由 `tests/session.test.ts:89-145` 锁定，反向破坏红验锁定 `>=` 与 UTF-8 WS 计算。
- 单 WS 的实际 payload 边界在 `src/serve.ts:253-270`，生产入口在 `src/serve.ts:600-614`；`tests/serve.test.ts:48-80` 锁定 exact limit、UTF-8 bytes、slow-only close 与 sibling fan-out。
- 本 diff 未改 client render backlog、protocol/registry/lifecycle/notify/config，也未引入 retry、fallback 或通用背压机制。
