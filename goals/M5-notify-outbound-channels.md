# 里程碑进度：M5 — 通知出站通道（webhook 中间层）

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：进行中（2026-08-23 开卡）
- **预期产出**：注意力层的事件除了 Web Push，还能并行 POST 到用户配置的 webhook 出口，
  经 [message-pusher](https://github.com/songquanpeng/message-pusher) 或企业微信群机器人
  抵达 IM。用户在 Web Push 不可达的 Android 设备上也能收到提醒。
- **立项依据**：M4 收口时确认用户 Android 设备**收不到任何网页推送**（对照实验：Google 官方
  `simple-push-demo` 同样收不到），机理是设备到 `mtalk.google.com` 5228/5229/5230 长连接
  不通，属环境限制而非本项目缺陷（详见 [M4](M4-notify-attention.md)「Android 设备侧限制」节）。
  Web Push 侧无可修之处，覆盖 Android 的责任转由本里程碑承担。
- **当前范围**：
  - 做：`notify.channels` 配置、`src/notify/channels.ts` 出站层、三种内置通道类型
    （`message-pusher` / `wecom` / `webhook`）、与 Web Push 并行且互相隔离的分发、
    逐通道失败日志、通道发送纳入停机排空。
  - 不做：具体 IM 的 SDK/OAuth/富文本卡片、模板 DSL、重试队列、投递回执、通道级限流、
    替换 Web Push（iOS 上 Web Push 已验证可用且体验最好，必须保留）。
- **对应任务卡**：`docs/sessions/260823-edge-android-notify/cards/C-notify-outbound-channels.md`
- **关键决策**：
  1. **herdweb 不长渠道适配代码**。渠道扩展是 message-pusher 或用户接收端的职责；
     herdweb 只负责「把事件可靠地发出去，并且发失败时大声报错」。这也让开源用户
     接新渠道时不必改 herdweb 代码。
  2. 三种通道的请求形状固定、不可配（不自造模板 DSL）。特别注意 message-pusher 的
     JSON 形态字段是 `desp`（表单形态才叫 `description`），必须有测试锁死。
  3. 出站通道与 Web Push **并行**，任一侧失败不得影响另一侧。
  4. **凭据绝不落日志**：企业微信的密钥写在 URL 的 query string 里，message-pusher 的
     token 在 body 里。日志只允许记通道类型、目标 host、HTTP 状态码、成败。
     出处：agent-config core.md「生产诊断」节 #148。
- **已知阻塞**：无（实现不依赖真实凭据；用户的 message-pusher 实例地址与 token 在验收阶段
  写入 `.local` 配置即可）。
- **推进前必须拿到的证据**：
  - [ ] 单元测试全绿，含**安全闸**：给含 `?key=secret-value` 的通道 URL，捕获全部日志输出，
        断言该密钥不出现在任何一条日志里。
  - [ ] 跨进程边界验收：拦截 fetch，断言**实际发出的请求字节**（method / URL / headers /
        body JSON），不接受同进程「调用了某函数」式断言。
  - [ ] `pnpm test` / `tsc --noEmit` / `build:dist` / `check` / `lint:knip` 全绿。
  - [ ] **真实入口证据**：用户在自部署的 message-pusher（或企业微信群）真实收到一条
        herdweb 事件消息。库函数绿、单测绿都不算。
- **完成条件**：
  - 上述证据全部拿到，且用户在 **Android 设备**上通过 IM 收到 herdweb 的通知——
    这正是 M4 未能覆盖的那一半。
  - README 与 herdweb-setup skill 同步配置形状，并如实写明 Android Web Push 的已知限制。
