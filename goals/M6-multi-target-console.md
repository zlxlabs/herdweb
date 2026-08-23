# 里程碑进度：M6 — 多目标控制台

- **状态**：`planned`；待主脑验收 T0 后写入 `GOALS.md` 激活。T0 证据：[t0-multi-target-probe.md](../docs/sessions/260824-0035-multi-target-overnight/t0-multi-target-probe.md)。
- **目标**：一个单焦点移动控制台管理本机 `herdr --session` 与 SSH `herdr --remote` target；不扩展为远程设备管理平台。
- **reviewed 契约**：single/explicit 共用单一 `/ws` protocol 2；single 隐藏 picker 并自动附着合成 default，explicit stale/invalid ID fail loud。保持一个现有 client 状态机，不工厂化、不建 N 条连接；`attach-target` 使用 attachment capability/generation，geometry → snapshot → xterm callbacks drain → `attach-committed` 两阶段提交后才开输入。
- **范围**：最多 8 个 target、惰性启动、不 auto-evict；target 退出只改自身状态；registry、共享 shutdown gate/leases、targetId 隔离通知/草稿/image capability。
- **不做**：remote structured event bridge、herdr session discovery、缩略图/多画面、多连接前端、多租户、旧版本兼容。

## reviewed 卡链与 PR 增量

- T0：七项真实探针与路线图 gate（当前 partial/blocked）。
- 核心链：`T1a → T1b → T2a → T2b → T2c → T3a → T3b`（配置/投影、registry/lifecycle/backpressure、protocol 2、binding）。
- Lane A：`T4a → T4c → T4b → T5`；Lane B：`T6b → T6c`；Lane C：`T6a`；三 lane 收口后 `T7 → T9`。
- 五个 PR 增量：PR0=T0 证据与路线图；PR1=T1a–T3b；PR2=T4a/T4c/T4b/T5/T6a；PR3=T6b/T6c/T7；PR4=T9 文档与入口证据。

## 路线图五问（2026-08-24）

- M4 真完成了吗？是；M5 真完成了吗？否，基础实现已合入但 Android IM 收件未证实；M6 尚未激活。
- 下一个目标对吗？是；T0 证明 SSH thin-client 路线可行，且不需要自建 hub。
- 有没有漏掉里程碑？没有；M6 覆盖多目标协议、生命周期、切换与 target 隔离，T0 是前置 gate。
- 新证据改变顺序了吗？是：先补手机与 silence 缺口，再验收/激活 M6；不以文档、curl、桌面 WS 或 argv 替代入口证据。
- done 定义还成立吗？成立；M6 还必须有当前手机入口上的实际输出、断链重连同一 pane 与失败态证据。

## 激活前后的用户入口证据

- [ ] T0 七项 gate 全部通过；当前 2、6 blocked，7 partial。
- [ ] 下一张产品卡前：用户在当前手机入口访问 remote target，确认初始终端输出、SSH 断开/重连后同一 pane、真实失败退出态；记录设备、浏览器、URL、时间和观察结果。
