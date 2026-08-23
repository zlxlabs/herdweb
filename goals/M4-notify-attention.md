# 里程碑进度：M4 — 注意力层 v1（Web Push 通知）

- **负责主脑**：Sisyphus（拆卡与验收）
- **状态**：代码完成，真机人工门待用户执行
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
  - [ ] **真机人工门**（不进 CI，用户执行）：
        Android Chrome + iOS 主屏 PWA 各一轮——①订阅成功 ②测试按钮→通知到达 ③点通知聚焦/打开
        ④ agent 跑循环后停 → 静默通知 ⑤ `systemctl --user restart` 对应实例 → 一次事故只收一条
        ⑥历史列表可回看
  - [ ] curl 直发 `/api/events` 全链路通（不依赖 #495）
- **完成条件**（引用 HANDOFF 用户可感知验收）：
  - 代码与文档合入 `feat/notify-attention` 且 CI 全绿。
  - 真机人工门清单由用户在 Android Chrome 与 iOS 主屏 PWA 各执行一轮并确认。
  - badge 车道在 agent-config#495 合入并联调前，里程碑视为「通知基础设施就绪」，不宣称 agent 节律告警已上线。
