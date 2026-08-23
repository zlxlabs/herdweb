# 里程碑进度：M4 — 注意力层 v1（Web Push 通知）

- **负责主脑**：Sisyphus（拆卡与验收）
- **状态**：**已完成**（2026-08-23）——代码合入 main（PR #46，release 1.2.0），生产实例 7681
  部署完毕，iOS 生产入口真机全链路验证通过。Android 侧结论见「Android 设备侧限制」节：
  Web Push 在用户设备上不可用且**非本项目缺陷**，解法转由 M5 出站通道承担。
- **预期产出**：手机（Android Chrome；iOS 须主屏 PWA）打开 herdweb，在 ☰ 抽屉进入通知面板完成订阅，
  点「Send test notification」立刻收到系统通知，点通知聚焦/打开 herdweb；agent 持续输出后停下 ≥3 分钟
  收到「可能完工/卡住」静默通知；herdweb 服务重启/会话死亡收到通知且一次事故只有一条；错过的通知
  在面板历史列表可回看。README 与 herdweb-setup skill 如实写明延迟与 iOS 前提。
- **当前范围**：
  - 做：`POST /api/events`、Web Push 管道、静默/健康/测试车道、事件历史、☰→🔔 通知面板、
    按端口分仓状态目录、停机排空、CSP `worker-src`、service worker（push / notificationclick）。
  - 不做：badge 出站车道（`asking`/`done`/`ci-red` 的外部源在 agent-config#495）、跨机事件源、
    通知内审批、通知深链、多设备订阅 UI、解析 agent 终端输出。
- **对应任务卡**：`docs/sessions/260822-2132-notify-attention/HANDOFF.md`（卡 1–3 + 收尾卡 t4）
- **关键决策**：
  1. 状态目录按端口分仓 `~/.local/state/herdweb/{port}/`；7681 与 7691 绝不共享。
  2. `POST /api/events` 仅回环 + 可选 `notify.token`；202 ≠ 手机已展示。
  3. badge 车道（asking/done/ci-red）典型 60–90 秒节律，但 **agent-config#495 未合入前不可用**——
     文档不得写成已可用。
  4. herdweb 自有静默车道典型延迟 3–5 分钟；健康车道在 PTY 退出/重启时触发，120s 内 crash-loop 只推一条。
  5. iOS 必须主屏 PWA（iOS 16.4+）；Safari 标签页无 Push API。
- **已知阻塞**：无（代码侧）；badge 车道依赖 agent-config 侧认领。
- **进度**：卡 1（推送管道）、卡 2（内部车道）、卡 3（历史收件箱）已合入 `feat/notify-attention`；
  收尾卡 t4（README、skill、本文件、AGENTS、deploy 文档）在 `card/notify-t4`。
- **推进前必须拿到的证据**：
  - [x] 全量单测 + Playwright 绿；环境：本地 worktree；命令：`pnpm test`、`pnpm run test:pw`
        （执行器 t4 收尾复跑）
  - [x] lint/format 绿；命令：`pnpm run check`
  - [x] **真机人工门 · iOS**（用户执行，2026-08-23）：**生产入口** `https://herdr.zlxlabs.com/`
        （Cloudflare Tunnel + Access）主屏 PWA——订阅成功、测试通知到达。
        服务端硬证据：`~/.local/state/herdweb/7681/push-subscriptions.json` 落 Apple 端点一条；
        `journalctl --user -u herdweb.service` 出现 `notify push delivered → web.push.apple.com`；
        订阅前的点击如实记为 `notify push skipped — no subscriptions`。全程无 403，
        Cloudflare Access 不干扰 Service Worker 注册与订阅请求。
  - [ ] **真机人工门 · Android**：**判定为环境不可达，不作为完成条件**，见下节。
  - [x] curl 直发 `/api/events` 全链路通（测试实例 7701 实证，不依赖 #495）
- **完成条件**（引用 HANDOFF 用户可感知验收）：
  - 代码与文档合入 `feat/notify-attention` 且 CI 全绿。
  - ~~真机人工门清单由用户在 Android Chrome 与 iOS 主屏 PWA 各执行一轮并确认。~~
    **2026-08-23 修订**：iOS 生产入口已执行并确认；Android 侧经排查判定为设备/网络环境
    不可达（对照实验证据见「Android 设备侧限制」节），**该平台不作为本里程碑的完成条件**，
    覆盖 Android 的责任转由 M5 出站通道承担。
  - badge 车道在 agent-config#495 合入并联调前，里程碑视为「通知基础设施就绪」，不宣称 agent 节律告警已上线。

## 收口期修复（2026-08-23，PR #46 合并前）

真机排障中发现两个真缺陷，均已修复合入：

| Task-Id | 缺陷 | 根因 |
|---|---|---|
| herdweb-notify-20260823-02 | 用不带尾斜杠的 URL 打开时，通知面板恒显示「Service Worker：未注册 / unavailable or timed out」，订阅开关恒灰 | SW 注册与 manifest 的 scope 用 `${basePath}/`（带尾斜杠），页面 URL 为裸 `basePath` 时不在 scope 内：`register()` 照常 resolve、`getRegistration()`（无参，按当前页面匹配）返回 undefined、`ready` 永不 resolve。修复为 scope 放宽到裸 `basePath`，面板显式按 scope 查询并移除对 `ready` 的依赖 |
| herdweb-notify-20260823-01 | 手机订阅成功后被静默抹掉，此后收不到任何通知且服务端零报错 | `pushToAll` 在推送前读订阅快照，await 网络推送后用**旧快照**整体覆盖磁盘，吃掉期间新增的订阅。修复为基于磁盘最新内容做增量合并（仅应用 lastSuccessAt 更新与失效端点删除），并用快照比对守住「期间被重新订阅则不删」 |

**纠正一条既有误判**：此前记录的「Edge 151 `serviceWorker.ready` 永久挂起」不是浏览器缺陷，
而是页面本就不在 scope 内。相关注释已按真实根因改写，避免后人继续绕一个不存在的 bug 打补丁。

## Android 设备侧限制（2026-08-23 定案）

用户 Android 设备（Edge for Android 151 / Android 10）**收不到任何网页推送**，
经排查确认为设备/网络环境问题，**不是 herdweb 缺陷**：

- 服务端侧全部走通：订阅落盘、推送发出、`delivered → fcm.googleapis.com`（FCM 已接受）。
- 设备侧收不到。对照实验：Google 官方 `simple-push-demo` 在同一设备上**同样收不到**。
- 机理：Android 的网页推送依赖 Google Play 服务到 `mtalk.google.com`
  **5228/5229/5230 端口的长连接**，与浏览器的 80/443 流量是两条路。
  **「浏览器能正常访问 Google/YouTube」不能推出「FCM 可达」**——多数旁路由分流规则
  只覆盖网页端口，该长连接仍直连并被阻断。
- 用户排除项（均已确认不是原因）：非无痕模式、系统与浏览器两层通知权限均已开启、
  通知栏无静默到达的通知、页面处于前台（Service Worker 醒着）。

**处置**：不再为此投入 Web Push 侧的修复。解法是 M5 出站通道
（webhook → message-pusher / 企业微信），让事件经 IM 抵达 Android。

## 排障方法留档

本次定位全程靠 `tcpdump` 抓 lo 口明文请求（看浏览器**实际发出了哪些请求**），
而非服务端日志——因为两个缺陷都是**静默**的：订阅被覆盖不报错，SW 查不到只给一句
含糊的 `unavailable or timed out`。关键判据是「点了『重新注册』但**没有** `sw.js` 请求」，
它同时证伪了「脚本下载失败」并指向 scope 不匹配。

教训已固化为 M5 卡的硬性完成条件：每条出站通道的成败都必须落日志，
且日志只准记通道类型、目标 host、状态码——**绝不打印含凭据的完整 URL**
（企业微信的密钥就写在 query string 里）。
