FAIL

# PR #128 notify patrol 终审

- 被审 head：`5b2110691f8398931fe07560fb3e82e4c87b55e4`
- 固定审查范围：`4b9aa5b8562d241cb6079a4a7fb3306d16eafd4d..5b2110691f8398931fe07560fb3e82e4c87b55e4`
- 审查时间：2026-08-30 20:48:01 +0800
- 项目风险档：personal；P1 仅限数据丢失、静默出错或崩溃
- 本轮新证据：固定 SHA diff、issue #127 原始 payload、`history.ts`/`service.ts`/`state.ts`/`silence.ts` 调用链、single/explicit 文档契约，以及秒/毫秒时间解释结果。
- 验证边界：按任务卡要求未运行被审分支测试；使用代码读取与调用链推理，并运行了 OCR 前置扫描。

## Findings

### P1-1：巡查真实 payload 的秒级 ts 在历史面板被静默当作毫秒

- 位置：`src/controls/notify-panel.ts:90-113`（输入值由 `src/notify/events.ts:220-225` 原样保留）；真实 fixture 为 `tests/notify-events.test.ts:197-200,269-273`。
- 缺陷：agent-config issue #127 的真实 payload 使用 `ts=1788090200`，这是 Unix 秒（对应 `2026-08-30 19:43:20 +0800`）；面板的 `new Date(ts)`、`now - ts` 均按 JavaScript 毫秒解释。`formatRelativeTime` 因此把该事件判成超过 30 天，最终展示约 `1970-01-22`，而不是巡查发生时间。
- 触发场景：向 single-mode 的 `POST /api/events` 发送任务卡中的完整 patrol JSON → parser 通过、HTTP 返回 202、`events.jsonl` 保存原始 `ts=1788090200` → 打开通知面板并加载历史 → 时间文本/悬浮时间显示 1970 年；整个链路无错误提示。这个输入已由 issue #127 标明为真实生产 payload，故满足 personal 档 P1 两问：真实使用会触发，历史时间错误不可接受。
- 建议方向：在 ingress 明确解决 producer 的时间单位（consumer 对 patrol 秒级值规范化为毫秒，或先将 producer/契约改为毫秒并同步 fixture）；补一条真实 HTTP→history→panel 的时间断言，不能只断言 badge。不要只改展示层而继续让落盘时间和其它消费者单位不一致。

## 重点审查方向

### 1. 字段白名单顺序

结论：未发现问题。`src/notify/events.ts:130-148` 仍先检查未知字段，再校验版本和 kind；新增的 `task_id`、`dispatch_id`、`drift` 已同时加入白名单，因此合法的 `kind=patrol` 生产载荷不会因新字段被误拒。含任意未知字段仍返回 400；无效 kind 即使携带新字段也仍返回 400；新增字段本身只接受字符串，未发现意外放行组合。

### 2. v1/v2 与 targetMode 交互

结论：可接受，且不构成静默丢弃。`src/notify/events.ts:256-269` 明确规定 single 只接受 v1、explicit 只接受 v2；文档 `docs/configuration.md:209-214,426-436` 与 `docs/deploy-herdr.md:179-180,202` 也将该限制作为契约。生产 unit 的 single 模式接收 producer 的 v1 patrol；debug explicit 模式收到同一 v1 载荷会显式返回 400（`explicit mode requires v2`），而非返回成功后丢失。若把只会发 v1 的 producer 指向 explicit debug 端点，是部署契约不匹配，不是本 PR 新增的静默错误。

### 3. 出站决策的门序

结论：未发现问题。`src/notify/attention-policy.ts:39-54` 的首个分支只匹配 `silence` 或 `patrol`，不会吞掉其他 kind；patrol 返回 `withhold/not-attention` 后不会进入推送或渠道发送。`src/notify/service.ts:400-433` 中 away-mode 或显式离场信号可能先释放一个此前已排队的 presence-deferred 事件，这是已有的 flush 语义；随后当前 patrol 仍经过首门并被 withhold。likely-present、likely-away/unknown 和 awayMode 组合均不会让 patrol 绕过该门。

### 4. 两处 `KIND_LABELS` 的类型完整性

结论：未发现问题。`src/notify/channels.ts:4-12` 使用 `Record<NotifyKind, string>` 并包含七个 kind；`src/controls/notify-panel.ts:23-30` 使用 `Record<Exclude<NotifyKind, 'test'>, string>` 并包含六个非 test kind，`kindLabel()` 对 test 单独返回标签。两处没有 `as`、`any` 或非空断言绕过全量映射；新增 `patrol` 会被 TypeScript 的 Record 约束锁住。

### 5. 未改动的 history/service、rate-limit、silence 兼容性

结论：未发现新的存储、面板、限流或 silence 逻辑遗漏，但面板时间问题见 P1-1。`src/notify/history.ts:22-33` 通过共享 `isNotifyKind()` 接受 patrol 且仍排除 test；`src/notify/state.ts:106-112` 只排除 test 并原样 JSONL 落盘，所以三个 snake_case 字段会保留。`src/notify/service.ts:381-423` 对 patrol 正常做 target-mode 校验、去重、历史写入和决策；`src/notify/routes.ts:134-148` 的 60 次/分钟入口限流对所有事件一致，远低于巡查最多每 20 分钟 11 条的给定频率。

`recordLastEvent()` 会记录所有非重复事件，但真实 patrol payload 没有 `session`，其 key 是 `targetId\0`；silence detector 查询的是 `targetId\0sessionKey`（`src/notify/service.ts:242-245,459-460` 与 `src/notify/silence.ts:81-92`），因此该真实 payload 不会错误地抑制 target 会话的 silence。若 patrol 另带已有的 `session` 字段，则沿用所有事件共享的 lane-cooldown 语义，并非本次新增分支的遗漏。

### 6. 测试的约束力

结论：新增测试对主要代码分支有约束力，但漏掉了 P1-1 的时间单位不变式。`tests/notify-events.test.ts:82-89,197-243` 能在移除 patrol kind、任一字段白名单/类型校验、字段回传或错误加入 drift 枚举时变红；`tests/notify-events.test.ts:269-287` 的真实 HTTP payload 会锁住 202、落盘 kind/task_id/drift。`tests/notify-attention-policy.test.ts:116-128,342-356` 能在 patrol 分支缺失或门序被 presence/away 绕过时因推送调用和决策日志断言变红；两个 `KIND_LABELS` 的缺失会分别使 `tests/notify-channels.test.ts:97` 或 `tests/notify-panel.test.ts:1025-1061` 变红。

真实 producer 字符串在 parser 测试和 HTTP 测试中均内联，且 HTTP 测试跨过了真实 JSON→route→JSONL 边界；它不是恒真断言。但这些断言只检查 badge、kind 和字段，不检查 `ts` 被面板按何种单位渲染，因此没有锁住 P1-1。按卡面禁止，本轮未在被审分支运行测试；OCR 前置扫描为 `status=reviewed`、`coverage=complete`、`findings=[]`，不能替代上述静态与时间单位核对。

## 本轮结论

存在 1 条 P1（P1-1），所以 verdict 为 `FAIL`。前三条出站/协议方向和第四、第五条兼容性核对未发现其它 finding；巡查默认不出站、drift 不做枚举、snake_case 字面 key 三项锁定决策均未作为 finding。
