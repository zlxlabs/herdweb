# 项目里程碑路线图

## 项目目标

- **目标**：在 Android 和 iOS 手机上，经 Cloudflare Tunnel + Access 使用 herdweb/herdr 时，
  离开几十分钟、切网或锁屏回来后，用户能同时确认三件事——**看到的画面是新鲜的**、
  **写了一半的长语音草稿还在**、**刚提交的整条指令到底收没收到**。
- **完成定义**：三条不变式全部在 Android 与 iOS 的**真实生产入口**上各验证过一次，
  且 `pnpm test` / `pnpm run test:pw` / `pnpm run check` / `pnpm run build:dist` 全绿。
  单测绿、draft PR 绿都不算完成。

设计出处：`docs/designs/weak-network-experience.md`（CEO + Eng review 均 CLEAR）。

## 当前激活里程碑

- **M6 — 多目标控制台**（2026-08-24 激活）：按 reviewed 卡链增量实现。T0 尚缺的手机与
  silence 证据作为最终验收前的证据债保留，不阻塞产品卡落地。

## 里程碑索引

| ID | 名称 | 状态 | 排序 | 优先级 | 跨里程碑依赖 | 进度文件 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | 草稿不丢 | 已完成 | 1 | 高 | 无 | [goals/M1-draft-survives.md](goals/M1-draft-survives.md) |
| M2 | 画面新鲜可信 | 已完成 | 2 | 高 | 无 | [goals/M2-fresh-screen.md](goals/M2-fresh-screen.md) |
| M3 | 提交不重不漏 | 已完成 | 3 | 高 | M1、M2 | [goals/M3-atomic-submit.md](goals/M3-atomic-submit.md) |
| M4 | 注意力层 v1（Web Push 通知） | 已完成 | 4 | 高 | 无 | [goals/M4-notify-attention.md](goals/M4-notify-attention.md) |
| M5 | 通知出站通道 | 验收待补 | 5 | 高 | M4 | [goals/M5-notify-outbound-channels.md](goals/M5-notify-outbound-channels.md) |
| M6 | 多目标控制台 | 进行中 | 6 | 高 | 无 | [goals/M6-multi-target-console.md](goals/M6-multi-target-console.md) |

## 路线图审计

- **审计日期 / 增量**：2026-08-22 · M1/M2/M3 全部完成，路线图收口
- **里程碑真完成了吗？**：是。M1 四条、M2 六条、M3 五条证据逐条拿到；真机入口按用户指令
  走 Tailscale tailnet dev 实例（原计划 Cloudflare 生产入口，差异仅认证层，已记录在
  各 goal 文件）；设计文档 Success Criteria 8 条逐条对照通过（对照表见 M3 文件）。
- **下一个目标还是对的吗？**：路线图已无剩余项。项目目标的「完成定义」（三不变式双平台
  真机验证 + 全量检查绿）已达成。
- **有没有漏掉的里程碑？**：无。遗留 backlog：M2 的 P2（terminalFailed 后 PTY onData
  未解绑空转计数）已记录在设计文档，风险可接受，非里程碑。
- **新证据是否改变了工作顺序？**：无。
- **done 的定义还成立吗？**：成立且已达成。
- **审计结论**：弱网体验路线图完成收口，无悬空工作。

### 2026-08-24 · 激活 M6

- **里程碑真完成了吗？**：M4 已完成；M5 基础实现已完成但 Android IM 收件证据待补；M6 未完成。
- **下一个目标还是对的吗？**：是。T0 已证明 SSH thin-client 路线可行，无需自建 hub。
- **有没有漏掉的里程碑？**：没有。M6 覆盖已 reviewed 的多目标配置、生命周期、协议、切换和隔离。
- **新证据是否改变了工作顺序？**：T0 手机入口与 silence 证据不再阻塞实现，改为最终验收前补齐；
  产品卡从 T1a 开始按依赖链推进。
- **done 的定义还成立吗？**：成立。最终仍须在当前手机入口验证实际输出、断链重连同一 pane 与失败态。
- **审计结论**：激活 M6；保留 T0 未完成项，不把证据缺口误当成代码开工闸。
