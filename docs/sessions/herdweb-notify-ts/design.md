# DESIGN-note：通知入口拒绝秒级时间戳

## 目标

新进来的通知事件如果时间戳看起来是 Unix 秒而不是毫秒，入口直接拒绝，面板不会再静默显示 1970。

## 非目标

不订正已经入库的旧秒级事件。不改面板格式化。不给 startedAt / presenceAt 加下界。不修方向键端到端。本批另一张卡只重新量 e2e 基线，不在本卡做。

## 方案要点与已否决方案

- 要点：只在 parseNotifyEvent 加下界 `NOTIFY_TS_MIN_MS = 1_000_000_000_000`。HTTP 事件入口已经走这个函数，不必再做第二道。测试里所有喂给解析器的秒级假数据改成毫秒。文档改为「ingress 会 400」。
- 已否决：在入口把秒启发式换成毫秒（永久掩盖发送方回归，且不同 kind 行为不一致）。现在就关 #129 不加校验（静默出错路径还在）。给 GitHub Actions 开 bypass、加大 e2e 超时、给本地开 retries、给 fixture 默认屏蔽 Service Worker、把 Synced 塞进重连文案正则——均属本会话链已否决，与本卡无关也不要顺手做。

## 关键不变式

1. Unix 秒进不了库。代码：src/notify/events.ts parseNotifyEvent。测试：tests/notify-events.test.ts 秒级样本与 HTTP 400。
2. 真毫秒仍 202。代码：同一函数下界含等。测试：边界 1e12 接受 + HTTP persist。
3. 文档与实现一致。代码：docs/configuration.md Local events API。测试：收尾 rg 不得命中 does not range-check。

## 验收路径

1. 入口：loopback POST /api/events（文档里的 curl 形态）。
2. 步骤：一条 ts=$(date +%s000) 期望 202；一条 ts=$(date +%s) 期望 400。单元测试锁死这两条，不必在本卡对活服务 curl。
3. 预期：秒级被拒且不入库；毫秒仍入库。
