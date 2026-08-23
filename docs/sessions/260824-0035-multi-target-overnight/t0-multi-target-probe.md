# T0 多目标真实探针证据

日期：2026-08-24；基线：`092808f`；探针只使用临时端口 `7682/7683`，未触碰生产 `7681`。

## herdr/SSH spawn

- 环境：本机源码，SSH 别名 `mac-studio`，远端 `herdr 0.7.5`，`default` session 有 pane `w1:p1`。
- 命令：`XDG_STATE_HOME=/tmp/herdweb-t0-state.winq3V pnpm exec tsx cli.ts serve --host 127.0.0.1 --port 7682 -- herdr --remote mac-studio`。
- 观察：真实 WebSocket `/ws` 收到 `snapshot`，`sessionId` 非空、`outputWatermark=16`、终端数据 4015 bytes；SHA-256=`cd668717ec62a7566ceae23664bb44008f670ec34f4c654028826d3fcb136627`。
- 结论：本地 herdweb→PTY→`herdr --remote`→SSH→远端 herdr 的 spawn/协议路径真实可用；不以 SSH argv、进程存在或退出码推断远端健康。

## pane 重连持久性

- 同一 7682 实例断开并重连 WebSocket：两次 `sessionId` 相同，snapshot 均 4015 bytes、watermark 16、上述 SHA 相同。
- 停止 7682 后，远端 `herdr pane list` 仍返回 `w1:p1`、revision 5、idle；`herdr pane read w1:p1 --source visible` 两次均 881 bytes、SHA-256=`17b920869d7748cc1fab831a98f05cbd01efead23b2d4f2ddd7e93b78fea9c71`。
- 重启同命令后再次收到 4015-byte snapshot，SHA 与停机前相同；结论：断开本地 SSH thin-client 后远端 pane 内容可重新附着。证据来自 herdr pane API 与实际终端 payload。

## 失败退出码

- 命令：`... --port 7683 -- bash -c 'printf "t0-failure-probe\\n"; sleep 10; exit 37'`。
- 观察：真实 WebSocket 先收 25-byte snapshot，再收 `{type:"exit",exitCode:37,signal:0}`；结论：本地 PTY/WS 退出码传递可观测，不能外推远端 pane 状态。

## 当前手机入口探活

- 生产真实入口 `https://herdr.zlxlabs.com/`：单独 `curl -sS -o /dev/null`，HTTP `302`；当前 `herdweb.service`=`active`、监听 `127.0.0.1:7681`。
- 当前调试入口 `127.0.0.1:7691/herdweb/`：HTTP `200`，真实 WS `/herdweb/ws` 收到 4180-byte snapshot；`herdweb-debug.service`=`active`，Tailscale serve 状态观察到 debug route。

安全记录：临时探针沿用了本机配置，退出时观察到一条仅含通道 host/status 的 WeCom delivered 日志；未记录凭据或 body，未触碰生产 unit。
