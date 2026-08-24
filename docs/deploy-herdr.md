# herdr 部署 runbook

本仓维护 herdr 上 herdweb 的生产和 Tailscale 调试运行时契约。默认只监听回环地址，外部认证
和隧道仍由现有 Cloudflare Access、Cloudflare Tunnel、Tailscale 配置负责；生产/调试实例必须
使用不同端口和不同通知状态目录。

## 拓扑

| 用途 | 外部入口 | 本机监听 | herdr 会话 |
| --- | --- | --- | --- |
| 生产 | `https://herdr.zlxlabs.com` | `127.0.0.1:7681` | `default` |
| Tailscale 调试 | `https://<tailnet>/herdweb/` | `127.0.0.1:7691` | `herdweb-dev` |

调试入口的 `/herdweb/` 前缀对应 `--base-path /herdweb`，反向代理目标是
`127.0.0.1:7691`；调试服务不得占用生产的 `7681` 端口。

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

生产持久路径固定为 `~/.local/share/herdweb`（XDG data 目录下的独立 clone，与
`~/.config/herdweb`、`~/.local/state/herdweb` 对齐），由 `scripts/serve-prod.sh` 启动。
该脚本用 `git symbolic-ref` 检查当前分支必须是 `main`；detached HEAD 或其他分支会直接失败。
unit 的 Node PATH 使用 fnm `aliases/default/bin` 和 `~/.local/bin`，不绑定版本目录。

生产 unit 的关键部分如下；密钥只放 XDG 配置或 `.local` 文件：

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

首次部署（克隆独立的生产副本并安装 unit）：

```bash
git clone <repo> ~/.local/share/herdweb
cd ~/.local/share/herdweb
pnpm install --frozen-lockfile
scripts/install-prod.sh --enable
systemctl --user status herdweb.service
```

生产配置走 XDG 路径 `~/.config/herdweb/herdweb.config.ts`。配置解析顺序是
`cwd/herdweb.config.{ts,js}` → `$XDG_CONFIG_HOME/herdweb/herdweb.config.{ts,js}`；生产 clone
的 cwd 没有 git 跟踪的配置文件，因此通常落到 XDG 位置。密钥放配置或同目录的 `.local` 兄弟
文件中，不写入 git。

## 当前版本切换

当前生产切换入口是生产 clone 中的 `scripts/update-prod.sh`：

```bash
~/.local/share/herdweb/scripts/update-prod.sh
```

它实际只执行 `git pull --ff-only`、`pnpm install --frozen-lockfile`，然后
`systemctl --user restart herdweb.service`；脚本自身不检查 unit、端口或公网暴露。更新前后由
运维显式执行这些检查：

```bash
systemctl --user is-active herdweb.service
ss -ltn | grep -E '127\.0\.0\.1:7681'
~/.local/share/herdweb/scripts/check-exposure.sh https://herdr.zlxlabs.com
```

`check-exposure.sh` 的判据是：首页未认证应为认证门状态（`401`/`403`/`302`，或 `200` 但明确
显示身份门）；未认证 `/ws` 不得返回 `101`。脚本退出码 `0` 表示受保护，`1` 表示直接暴露，
`2` 表示无法判定，不能把未知当作通过。本节不提供兼容或回滚矩阵。

只安装而不启用：

```bash
scripts/install-prod.sh
```

## Tailscale 调试

调试 unit 不使用 `serve-prod.sh`；现有 unit 的 `WorkingDirectory`、`pnpm exec tsx cli.ts` 入口和 config 均固定到主仓
`/home/zlx/projects/oss/herdweb`，从 worktree 运行 installer 也不会切换到该 worktree。安装只复制 unit 并 daemon-reload，不 enable、不 start：

```bash
cd /home/zlx/projects/oss/herdweb
scripts/install-debug.sh
systemctl --user start herdweb-debug.service
systemctl --user status herdweb-debug.service
```

结束调试后停止 unit；禁止对它执行 `enable`：

```bash
systemctl --user stop herdweb-debug.service
```

调试 unit 使用 `/home/zlx/projects/oss/herdweb/.omo/herdweb-debug.config.ts`，密钥只放该本地
配置或本机环境中，不写入 git。

## 通知状态目录（按端口隔离）

状态写在 `~/.local/state/herdweb/{port}/`（或 `$XDG_STATE_HOME/herdweb/{port}/`）。生产 `7681`
与调试 `7691` 必须使用不同目录，避免 VAPID、订阅和历史互相覆盖。

| 文件 | 说明 |
| --- | --- |
| `vapid.json` | VAPID 密钥（`0600`）；缺失时首次启动自动生成 |
| `push-subscriptions.json` | 已注册推送端点 |
| `events.jsonl` | 事件历史；`kind=test` 不落盘 |
| `last-session.json` | 按 target 身份记录 session 退出事实，供健康车道判断重启/退出 |

轮换 VAPID：在配置或 `.local` 配置中设置 `notify.vapid.*` 覆盖；旧订阅会失效，用户必须重新
订阅。`POST /api/events` 仅接受同机回环请求；badge 事件源也必须与 herdweb 同机。

### 重启与通知预期

- PTY 退出：健康车道推送会话结束通知，任意退出码或信号都应可见。
- 服务重启：只有新 session id 与上次不同且上次 `exitedAt` 距今超过 **120 秒**，才额外推送
  服务重启通知；120 秒只抑制额外的服务重启通知，不抑制每次 target/PTy exit event，包括 crash-loop。
- 停机顺序：先停止接入、关闭 listener/连接，再 dispose target sessions；所有 target exit facts 完成后 drain notify。

重启后可按端口检查状态目录：

```bash
ls -la ~/.local/state/herdweb/7681/
ls -la ~/.local/state/herdweb/7691/   # 仅调试实例运行时应存在
```

single 事件是 v1（无 `targetId`），explicit 事件是 v2（必须带有效 `targetId`）；历史、去重、
tag 和通知点击目标都按该身份路由。

## 重启后检查

```bash
systemctl --user is-enabled herdweb.service
systemctl --user is-active herdweb.service
ss -ltn | grep -E '127\.0\.0\.1:(7681|7691)'
```

生产重启后应是 `127.0.0.1:7681` 与 herdr `default`；调试只有手动 start 后才应出现
`127.0.0.1:7691` 与 `herdweb-dev`。生产 unit 应为 enabled，调试 unit 保持未 enable。

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
