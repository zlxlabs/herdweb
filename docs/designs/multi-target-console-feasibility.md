# 多目标控制台可行性调研（历史方案）

- 日期：2026-08-25
- 状态：**已被最终实现取代**。本文保留调研背景与 T0 原始证据，不再作为实现方案或完成证据。

## 最终实现

历史实现基线（`6bb669d76aa9b6f4cbbe0dbf77e12abbda9be5b5`，release 1.10.0 后）已经落地一条单焦点控制台路径：服务端
`TargetRegistry` 按需持有多个 `SharedTerminalSession`，浏览器仍只建立一条同源 `/ws`，同一时刻只
有一个 committed attachment。切换目标会使旧 attachment 失效；新目标完成 snapshot 应用后才
提交并重新开放输入。

配置中的 command 是服务端私有的 spawn argv。`herdr --remote <host>` 可以作为一个 target 的
命令，但 herdweb 只证明本地 PTY/SSH thin-client 进程及其退出事实，不能从 argv、连接进程或退出码
推断远端 pane/session 健康。

## 被取代的历史判断

原稿曾把「一个 serve 进程起一个远程命令」、多连接前端、HAPI/hub 以及 sessionId 路由作为分步路线，
并把远端 SSH 退出解释成远端健康信号。这些判断均已废止；最终协议使用 target registry、单连接
attachment 状态机和逐 target capability，不建设浏览器多连接、远端结构化事件桥或 session 自动发现。

原稿的 herdr/SSH 与 HAPI 调研只作为背景；代码、协议测试和最终运行记录才是现行事实源。

## T0 与本次入口证据

- T0 原始探针见 [PR #71](https://github.com/zlxlabs/herdweb/pull/71)。其中记录了临时端口的真实
  `herdr --remote` spawn、pane 重连与失败退出码，并明确标记 Android/iOS 真机和 silence 条件
  为 partial/blocked；这些结果不能包装成多目标完成。
- 2026-08-25 本机验收：systemd `herdweb.service` 为 active/running、监听 `127.0.0.1:7681`，
  生产 clone SHA 为 `a8311a7067f47968821e6d477328b7e0689b04f2`，仍是 single `-- herdr --session default`；未改生产。
  当前基准源码在临时端口验证了 single attach commit、explicit `one → two` 切换、single-v1 /
  explicit-v2 通知路由和 committed image capability guard。
- PWA/手机证据：该次没有 Android/iOS 真实入口，因此 target 列表、切换/恢复/误输入保护、
  两种通知交付和 image capability 的手机验收为 **blocked**；桌面/本机协议探针为 **partial**。
- PR #108 / merge `5e8b0d8`（release 1.11.0 / `0a39414`）把 picker 改为 `targets.length <= 1` 不创建、
  不占布局高度；`> 1` 时手机/粗指针 badge 是底部 `#wt-toolbar` 的直接子节点，桌面/细指针仍在右上角。
- 2026-08-25 Android 真机经 Tailscale 调试入口验收：badge 不再遮挡 herdr 右上按钮，切换正常；
  HTTP 200，WebSocket protocol 2 返回 3 个扁平 target。未验收 iOS、通知、image capability 或远端 pane 健康。
