# herdr 部署 runbook

herdweb 是本机的 herdr 控制面。默认只监听 `127.0.0.1`，外部访问交给 Tailscale Serve、VPN
或其他可信隧道；生产/调试实例应使用不同端口和不同通知状态目录。

## 选择配置模式

### Single：命令行 `--` 覆盖默认 target

不配置 `targets` 时是 single 模式；配置文件最小可以是 `export default { name: 'herdr' }`。最小启动方式仍是：

```bash
herdweb serve --host 127.0.0.1 --port 7681 -- herdr --session default
```

`--` 后的 argv 只替换 single 模式的默认 target command；浏览器隐藏 target picker，始终附着
默认 target，不持久化目标选择。也可以省略 `--`，使用内置的
`herdr --session default`。

### Explicit：配置多个 target

显式 targets 使配置进入 explicit 模式；每个 target 必须有唯一的 `id`、名称和 command，且
`defaultTargetId` 必须指向其中一个。图片能力按 target 声明，未声明时为 `disabled`：

```typescript
export default {
  defaultTargetId: 'local',
  targets: [
    { id: 'local', name: 'Local', command: ['herdr', '--session', 'default'], imageDrop: 'local-path' },
    { id: 'workbox', name: 'Workbox', command: ['herdr', '--remote', 'workbox'], imageDrop: 'disabled' },
  ],
}
```

explicit 模式不接受 `herdweb serve ... -- <command>`；命令必须全部来自配置。服务端最多接受
8 个 target，浏览器只拿到名称、状态和 capability，不拿到 command/argv。

## systemd

生产 unit 的关键部分如下；路径按本机生产 clone 调整，密钥只放 XDG 配置或 `.local` 文件：

```ini
[Service]
Type=simple
Restart=on-failure
WorkingDirectory=%h/.local/share/herdweb
ExecStart=%h/.local/share/herdweb/scripts/serve-prod.sh serve --host 127.0.0.1 --port 7681 -- herdr --session default
```

explicit unit 把 `ExecStart` 改为不带 trailing command 的配置启动：

```ini
ExecStart=%h/.local/share/herdweb/scripts/serve-prod.sh serve --host 127.0.0.1 --port 7681 --config %h/.config/herdweb/herdweb.config.ts
```

安装/启用：

```bash
scripts/install-prod.sh --enable
systemctl --user is-active herdweb.service
```

## 当前版本切换

当前生产切换入口是 `scripts/update-prod.sh`：它在生产 clone 执行 `git pull --ff-only`、
`pnpm install --frozen-lockfile`，再 `systemctl --user restart herdweb.service`。切换前后只检查
unit 状态和白名单端口，不把进程连接状态当成远端 target 状态；本节不提供兼容或回滚矩阵。

## 通知状态

状态按监听端口隔离：`~/.local/state/herdweb/{port}/` 下有 VAPID、订阅、事件历史和 last-session
文件。single 事件是 v1（无 `targetId`），explicit 事件是 v2（必须带有效 `targetId`）；历史、
去重、tag 和通知点击目标都按该身份路由。badge 事件仍要求同机的事件源。

## 本机自用入口验收记录

记录时间：2026-08-25（Asia/Shanghai）。基准源码 SHA：`6bb669d76aa9b6f4cbbe0dbf77e12abbda9be5b5`。
所有探针使用临时端口/状态目录，未修改生产 unit、配置或对外入口。

| 入口 | 结构化结果 |
| --- | --- |
| `herdweb.service` | `active/running`；`127.0.0.1:7681`；生产 clone SHA `a8311a7067f47968821e6d477328b7e0689b04f2`；XDG `herdweb.config.ts`；single `-- herdr --session default`；`GET /`=`200`、manifest=`200` |
| 临时 single `17681` | protocol 2；`targets → attach-started → snapshot → snapshot-applied → attach-committed`；default committed |
| 临时 explicit `17682` | target 列表 `one,two`；同一 WS committed `one → two`；single-v1=`202`、v2=`400`；explicit-v2=`202`、v1=`400` |
| image capability | 无 header=`400`；stale header=`403`；当前 committed PNG=`200`、`0600`；探针文件已不在工作区 |
| SSH | `mac-studio` round-trip marker=`0`、远端 `herdr 0.7.5`、SSH marker 故意退出=`37`；临时 `17683` 的实际 argv 是 `herdr --remote mac-studio`，WS 有 protocol 2/sessionId，但 snapshot 为 0 bytes，未据此宣称远端 pane 健康；T0 原始 pane 重连见 [PR #71](https://github.com/zlxlabs/herdweb/pull/71) |
| Android/iOS PWA | **blocked**：本次无真实手机入口，未声称 target 列表/切换恢复/误输入保护、single-v1/explicit-v2 通知或 image capability 手机交付完成 |

探针只记录状态码、协议类型、SHA、退出码和 capability 等结构化结果；不记录生产日志、响应体或凭据。
