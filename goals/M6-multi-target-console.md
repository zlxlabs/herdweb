# 里程碑进度：M6 — 多目标控制台

- **状态**：`planned`；待主脑验收 T0 后写入 `GOALS.md` 激活。T0 证据：[t0-multi-target-probe.md](../docs/sessions/260824-0035-multi-target-overnight/t0-multi-target-probe.md)。
- **目标**：一个单焦点移动控制台管理本机 `herdr --session` 与 SSH `herdr --remote` target；不扩展为远程设备管理平台。
- **范围**：protocol 加 target 维度；客户端连接状态机可实例化；服务端 registry 惰性管理 target；单 PWA 内切换、通知和图片能力按 target 隔离。
- **不做**：remote structured event bridge、herdr session discovery、缩略图/多画面、多连接前端、多租户、旧版本兼容。

## 有序明细

1. T0：第二端口真实 remote spawn、失败退出、pane 重连、当前入口探活（已记录）。
2. T1：保持单一 `/ws` protocol 2，加入 target/session 路由与显式 attach/detach/list。
3. T2：工厂化客户端 socket/epoch/snapshot/heartbeat 状态机。
4. T3：服务端 target registry、惰性启动、退出隔离和统一 shutdown gate。
5. T4：移动端 picker/switch、target-scoped notify/image，以及真实入口验收。

## 路线图五问（2026-08-24）

- M4 真完成了吗？是；M5 真完成了吗？否，基础实现已合入但 Android IM 收件未证实；M6 尚未激活。
- 下一个目标对吗？是；T0 证明 SSH thin-client 路线可行，且不需要自建 hub。
- 有没有漏掉里程碑？没有；M6 覆盖多目标协议、生命周期、切换与 target 隔离，T0 是前置 gate。
- 新证据改变顺序了吗？是：先验收 T0/激活 M6，再开始产品代码；不以文档或 argv 替代入口证据。
- done 定义还成立吗？成立；M6 还必须有当前手机入口上的实际输出、断链重连同一 pane 与失败态证据。

## 激活前后的用户入口证据

- [x] T0 本机第二端口与当前真实入口探活已记录。
- [ ] 下一张产品卡前：用户在当前手机入口访问 remote target，确认初始终端输出、SSH 断开/重连后同一 pane、真实失败退出态；记录设备、浏览器、URL、时间和观察结果。
