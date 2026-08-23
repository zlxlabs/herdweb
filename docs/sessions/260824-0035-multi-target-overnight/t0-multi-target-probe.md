# T0 多目标真实探针证据

日期：2026-08-24；基线：`092808f`；探针只使用临时端口 `7682/7683`，未触碰生产 `7681`。

## 7 项真实探针逐项状态

### 1. 首次/再次连接延迟 — done

- 环境/命令：`XDG_CONFIG_HOME=/tmp/herdweb-t0-named-config.OAke79 XDG_STATE_HOME=/tmp/herdweb-t0-named-state.4mjKwL pnpm exec tsx cli.ts serve --host 127.0.0.1 --port 7682 -- herdr --remote mac-studio --session t0-multi-target-20260824`；真实 WS `/ws` 连续连接两次。
- 结果：首次 open/snapshot `6.9/7.4ms`，再次 `1.8/2.5ms`；均为 3200 bytes、watermark 14、sessionId 非空。

### 2. 锁屏、前后台、网络切换恢复 — blocked

- 环境/结果：当前执行环境没有真实 iOS/Android 设备控制会话；未以桌面 WS、curl 或计划推断替代，缺少锁屏、前后台、切网后的手机观察。

### 3. SSH auth/host-key 失败表现与退出码 — done

- 命令：`ssh invalid-t0-user@mac-studio true`；结果为 `Permission denied (publickey,password,keyboard-interactive)`、SSH exit `255`。
- 命令：`herdr --remote ssh://127.0.0.1:1`；结果为 `remote platform detection failed: ... Connection refused`、herdr exit `1`。未把失败码解释为远端 pane 健康。

### 4. 本地 thin client 退出后远端 pane 存续 — done

- `w1:p1` 的 `herdr pane read --source visible` 在断开前后均 881 bytes、SHA-256=`17b920869d7748cc1fab831a98f05cbd01efead23b2d4f2ddd7e93b78fea9c71`；重启 7682 后 snapshot SHA 仍为 `cd668717ec62a7566ceae23664bb44008f670ec34f4c654028826d3fcb136627`。
- 结论：以 herdr API 实际 pane payload 证明可重新附着，不以进程存在推断。

### 5. 远端命名 session attach — done

- 远端 herdr API 创建并列出 `t0-multi-target-20260824`；命令 `7682 -- herdr --remote mac-studio --session t0-multi-target-20260824` 收到 3200-byte snapshot、watermark 14。验证后删除本次临时 session，未清理历史 session。

### 6. iOS/Android 软键盘、触控、reconnect — blocked

- 环境/结果：没有真实 iOS/Android 设备会话，因此软键盘、触控、手机 reconnect 均未验证；当前生产/调试服务探活不计入手机证据。

### 7. 远程 target 的 silence/health 语义 — partial

- health done：停止远端临时 named session 后，隔离 `7682` 状态实际写入 `kind=health`、`session=t0-multi-target-20260824`、`title=...会话结束`、`reason=signal 0`，`last-session.json` 记录本地连接进程 `exitCode=1/signal=0`；当前 health 文案会让人误以为远端 session 已结束，属于真实语义漂移；后续 T6b/T9 必须改为仅陈述 target 连接进程退出与 code/signal，不得从 SSH/exit 推断远端 pane/session。
- silence partial：同一远端 target 按默认 `busyMs=30s/quietMs=180s` 观察 210s，`events.jsonl` 仍为空；当前 pane 未达到 busy-byte armed 条件，不能声称 silence 通知已送达。

## 当前生产/调试入口服务探活

- 生产入口 `https://herdr.zlxlabs.com/`：单独 `curl -sS -o /dev/null` 得 HTTP `302`；`herdweb.service`=`active`、监听 `127.0.0.1:7681`。
- 调试入口 `127.0.0.1:7691/herdweb/`：HTTP `200`，真实 WS 收到 4180-byte snapshot；`herdweb-debug.service`=`active`，Tailscale serve 观察到 debug route。以上是服务探活，不是手机证据。

安全记录：临时探针沿用了本机配置，退出时观察到一条仅含通道 host/status 的 WeCom delivered 日志；未记录凭据或 body，未触碰生产 unit。
