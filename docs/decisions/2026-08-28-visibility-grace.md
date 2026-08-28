# 2026-08-28 修订 T3 锁定决策 7：hidden 宽限 + 在场证据复用

## 决策

修订 `docs/sessions/cards/wnet-t3-client-reconnect.md` 锁定决策 7
「前后台强制换新连接、不许优化成 OPEN 就复用」。

新口径：

- `visibilitychange → hidden` 不再立即销毁 WebSocket。停掉心跳后启动
  `HIDDEN_SUSPEND_GRACE_MS = 60_000` 宽限定时器，到期才走原来的
  `suspendConnection()`。
- 回到 `visible` 且宽限未到期、socket 仍 OPEN 时，发一帧探活 ping
  （复用单在途心跳通道）。只有当前 epoch、nonce 匹配的 pong 才能续命；
  超时 / close / error 仍走现行退避重连 + 全量 snapshot。
- `freeze` / `pagehide` 维持立即 suspend，不进宽限期。
- 复用条件从来不是 `readyState === OPEN`，而是当前 epoch 内拿到新鲜 pong
  （`lastProvenFreshAt` + `FRESHNESS_WINDOW_MS`，以及 resume 探活本身）。

宽限时长和探活 deadline 是模块常量，不进 `ReconnectConfig`。

## 背景

Android PWA（standalone）短暂切后台再切回时，旧实现一进 `hidden` 就
`suspendConnection()`，切回来必然全量 snapshot 重放，并盖上全屏
「Syncing…」遮罩。即使只切走两秒，用户也要等 2–3 秒。

T3 决策 7 防的坑是「socket 看着 OPEN，其实早死了」。代码后来已经在
`pageshow` 路径引入在场证据（`src/client-entry.ts` 的 `lastProvenFreshAt`
只由当前 epoch 的 snapshot 成功和匹配 pong 写入）。本卡把同一机制推广到
`visibilitychange`：OPEN 本身仍不足信，新鲜 pong 才足信。

服务端会话与连接已经解耦（断开只 `clients.delete`，PTY 继续跑）。宽限期内
socket 仍活着时，服务端零感知，也不需要增量快照。

## 原决策

T3 锁定决策 7 原文要点：

- `hidden` / `pagehide`：立即离开 `synced`、停计时器、主动关闭当前 socket。
- `visible` / `pageshow`：无条件建新 epoch 并重新取完整 snapshot，
  **即使旧 socket 仍然显示 OPEN**。
- 明确禁止优化成「OPEN 就复用」。

## 修订内容

| 事件 | T3 决策 7 | 本卡 |
|---|---|---|
| `hidden` | 立即 suspend | 停心跳，60s 宽限后才 suspend |
| `visible` + 宽限未到期 + OPEN | 无条件新连接 | 探活 ping；pong 则保持同一 epoch / `synced` |
| `visible` + 宽限已到期或非 OPEN | 新连接 | 维持：立即新 epoch 重连 |
| `freeze` / `pagehide` | 立即 suspend | 不变 |
| 复用判据 | 禁止看 OPEN | 看当前 epoch 的新鲜 pong，不看 OPEN |

原目标「画面新鲜可证明」不受损：探活失败仍全量 snapshot；探活成功只证明
链路仍是刚才那条已 snapshot 过的连接。

## 为何原理由不再成立

决策 7 把「OPEN 不可信」和「因此必须无条件换新连接」绑在一起。前者仍然成立
（手机上半死 socket 是常态），后者不是唯一解。

现在已经有独立的在场证据：

1. `lastProvenFreshAt` 只由当前 epoch 的 snapshot / 匹配 pong 写入。
2. 心跳通道本身是单在途、带 nonce 的；错配或迟到的 pong 不续命。
3. resume 探活用同一通道、更短 deadline（4s）。没拿到匹配 pong 就按心跳
   超时走 `failConnection`，不会把僵尸 OPEN 当成活连接。

所以「不许 OPEN 就复用」这条禁令要保留的是禁令的**前提**（OPEN ≠ 活着），
不是禁令的**手段**（hidden 必须立刻杀掉 socket）。手段改成「hidden 先宽限，
回来用新鲜 pong 证明」，前提继续成立。
