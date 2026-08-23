# herdr 部署 runbook

本仓维护 herdr 上 herdweb 的生产和 Tailscale 调试运行时契约。生产服务只监听
`127.0.0.1:7681`，调试服务只监听 `127.0.0.1:7691`；外部认证和隧道仍由现有
Cloudflare Access、Cloudflare Tunnel、Tailscale 配置负责。

## 拓扑

| 用途 | 外部入口 | 本机监听 | herdr 会话 |
| --- | --- | --- | --- |
| 生产 | `https://herdr.zlxlabs.com` | `127.0.0.1:7681` | `default` |
| Tailscale 调试 | `https://<tailnet>/herdweb/` | `127.0.0.1:7691` | `herdweb-dev` |

调试入口的 `/herdweb/` 前缀对应 herdweb 的 `--base-path /herdweb`，反向代理目标是
`127.0.0.1:7691`。调试服务禁止占用生产的 `7681` 端口。

## 生产

生产 unit 的持久路径固定为 `/home/zlx/projects/oss/herdweb`，并由
`scripts/serve-prod.sh` 启动。启动脚本用 `git symbolic-ref` 检查当前分支必须是
`main`；detached HEAD 或其他分支会直接失败。unit 使用 fnm 的
`aliases/default/bin` 和 `~/.local/bin`，不绑定 `node-versions/`。

安装并启用生产 unit：

```bash
cd /home/zlx/projects/oss/herdweb
scripts/install-prod.sh --enable
systemctl --user status herdweb.service
```

只安装而不启用：

```bash
scripts/install-prod.sh
```

公网入口暴露检查只输出结构化状态，不输出响应体：

```bash
scripts/check-exposure.sh https://herdr.zlxlabs.com
```

预期：首页未认证时是认证门状态，未认证 `/ws` 不能返回 `101`。

## Tailscale 调试

调试 unit 直接从本仓源码启动，允许在非 `main` 分支或 worktree 中调试；它不使用
`serve-prod.sh`。安装只执行复制和 daemon-reload，不 enable、不 start：

```bash
cd /home/zlx/projects/oss/herdweb
scripts/install-debug.sh
systemctl --user start herdweb-debug.service
systemctl --user status herdweb-debug.service
```

结束调试后停止 unit；不要对它执行 `enable`：

```bash
systemctl --user stop herdweb-debug.service
```

调试 unit 使用本机配置文件
`/home/zlx/projects/oss/herdweb/.omo/herdweb-debug.config.ts`。密钥只放在该本地配置或
本机环境中，不写入 git。

## 通知状态目录（按端口分仓）

Web Push 运行时状态写在 `~/.local/state/herdweb/{port}/`（或 `$XDG_STATE_HOME/herdweb/{port}/`）。
**生产 7681 与调试 7691 必须使用不同目录**——共享会导致 VAPID、订阅与事件历史互相覆盖。

| 文件 | 说明 |
| --- | --- |
| `vapid.json` | VAPID 密钥（`0600`）；首次 `herdweb serve` 缺失时自动生成 |
| `push-subscriptions.json` | 已注册推送端点 |
| `events.jsonl` | 事件历史（`kind=test` 不落盘） |
| `last-session.json` | 按 `herdr --session` 键控，供健康车道判断退出/重启 |

轮换 VAPID：在 `herdweb.config.local.ts` 设置 `notify.vapid.*` 覆盖；用户需重新订阅。

`POST /api/events` 仅接受本机回环；外部 badge 车道（asking/done/ci-red）须与 herdweb 同机部署
（agent-config 出站见 [agent-config#495](https://github.com/zlxlabs/agent-config/issues/495)）。

### 重启与通知预期

- **PTY 退出**：健康车道推送「会话结束」通知（任意退出码/信号均推——监控面消失必须可见）。
- **服务重启**：仅当新 session 的 `sessionId` 与上次不同，且上次 `exitedAt` 距今 **>120 秒**，
  才额外推送「服务已重启」。120 秒内 crash-loop（反复退出又拉起）**只应收到一条**退出类通知，
  不应刷屏。
- **停机顺序**：PTY exit → 写 `last-session.json` → await 在途推送 → `server.close()`。
  运维 `systemctl --user restart herdweb.service` 后，已订阅手机应在一次事故内只收到符合上述
  规则的通知条数（典型：一次退出 + 可能一次重启，或 crash-loop 内仅一条）。

重启后除端口监听外，可检查状态目录是否按端口隔离：

```bash
ls -la ~/.local/state/herdweb/7681/
ls -la ~/.local/state/herdweb/7691/   # 仅调试实例运行时应存在
```

## 重启后检查

```bash
systemctl --user is-enabled herdweb.service
systemctl --user is-active herdweb.service
ss -ltn | grep -E '127\.0\.0\.1:(7681|7691)'
```

生产重启后仍应是 `127.0.0.1:7681` 与 herdr `default`；调试只有在手动 start
后才应出现 `127.0.0.1:7691` 与 `herdweb-dev`。

## 从 remobi 迁移到 herdweb

本节描述将已运行的 `remobi.service` 切换到 `herdweb.service` 的操作步骤，
同时完成本地目录改名（`~/projects/oss/remobi` → `~/projects/oss/herdweb`）与
Tailscale 调试入口前缀切换（`/remobi/` → `/herdweb/`）。

### 前置检查

确认当前生产 unit 状态：

```bash
systemctl --user is-active remobi.service
systemctl --user status remobi.service
```

预期：`active (running)`，监听 `127.0.0.1:7681`。

### 停止并禁用旧 unit

```bash
systemctl --user stop remobi.service
systemctl --user disable remobi.service
```

### 清理旧 unit 文件

```bash
rm -f ~/.config/systemd/user/remobi.service ~/.config/systemd/user/remobi-debug.service
systemctl --user daemon-reload
```

### 迁移本地调试配置（如存在）

```bash
cd /home/zlx/projects/oss/remobi   # 切换前仍在旧目录
mv .omo/remobi-debug.config.ts .omo/herdweb-debug.config.ts
mv .omo/remobi-debug.config.local.ts .omo/herdweb-debug.config.local.ts 2>/dev/null || true
cd ~ && mv projects/oss/remobi projects/oss/herdweb
```

若文件不存在可跳过；新调试 unit 引用 `herdweb-debug.config.ts`。

### 安装并启用 herdweb 生产 unit

拉取包含 herdweb unit 的 `main` 后：

```bash
cd /home/zlx/projects/oss/herdweb
git pull origin main
scripts/install-prod.sh --enable
```

### 验证

```bash
systemctl --user is-active herdweb.service
ss -ltn | grep 127.0.0.1:7681
scripts/check-exposure.sh https://herdr.zlxlabs.com
```

预期：

- `herdweb.service` 为 `active`
- `127.0.0.1:7681` 在监听
- `check-exposure.sh` 退出码 `0`（公网入口受身份保护）

### 回滚

若迁移后生产不可用，从 git 历史恢复旧 unit 并重新启用：

```bash
cd /home/zlx/projects/oss/herdweb   # 回滚时如已改名目录，先 mv 回 projects/oss/remobi
git show bc7b8ce:systemd/remobi.service > ~/.config/systemd/user/remobi.service
systemctl --user daemon-reload
systemctl --user stop herdweb.service
systemctl --user disable herdweb.service
rm -f ~/.config/systemd/user/herdweb.service
systemctl --user daemon-reload
systemctl --user enable --now remobi.service
```

将 `bc7b8ce` 替换为迁移前已知良好的 commit（上例为 herdweb 更名前的 `main`）。
旧 unit 文件在 git 历史中保留，无需单独备份。

若已迁移调试配置，回滚时可还原：

```bash
mv .omo/herdweb-debug.config.ts .omo/remobi-debug.config.ts
```

### 可选后续步骤

以下步骤不在本次更名范围内，按需单独执行：

**GitHub 仓改名**

```bash
gh repo rename herdweb
```

同步更新 `package.json` 中的 `repository` URL 及其他文档中的 GitHub 链接。

**本地目录改名**（`/home/zlx/projects/oss/herdweb` → `herdweb`）

需全链条同步：

- `systemd/herdweb.service` 与 `herdweb-debug.service` 中的 `WorkingDirectory`、`ExecStart`、`Documentation`
- `scripts/serve-prod.sh` 依赖的 `REPO_ROOT`（脚本内动态求值，改名后自动跟随）
- 所有 runbook 与文档中的绝对路径
- 本机 `~/.config/systemd/user/` 中已安装的 unit（重新 `install-*.sh`）
- 其他引用该路径的 systemd unit、软链、部署脚本

**Tailscale 入口 `/remobi/` → `/herdweb/`**

双侧同步：

1. herdweb 调试 unit：`--base-path /remobi` 改为 `--base-path /herdweb`，重新 `install-debug.sh`
2. Tailscale serve 配置：将路径前缀从 `/remobi` 改为 `/herdweb`
3. 验证 `https://<tailnet>/herdweb/` 可达且 `https://<tailnet>/remobi/` 不再暴露调试服务
