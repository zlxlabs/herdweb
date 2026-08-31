# 方案：把 herdweb 做成 herdr plugin

状态：**r2 修订版**，已过一轮 Codex 独立评审。日期 2026-08-31。
评审记录：`docs/sessions/plugin-design/reviews/plugin-design-verdict.md`（r1 verdict：暂不通过）。

## 修订记录

- **r1**（初稿）：主脑与用户四轮对话产出。
- **r2**（本版）：按 r1 verdict 的 4 条 P1 + 用户对 LAN 入口的决策修订。主要变更：
  1. **砍掉 `serve-lan`** —— plugin 永不主动 bind `0.0.0.0`（用户决策，安全优先）
  2. 新增 **§2.8 资源账本** —— 单例改用文件锁 + owner 元数据，不再靠探端口
  3. 新增 **§2.9 两个 runner 的边界契约** —— service 与 pane 同源
  4. 密钥路径改正：`.env.local` → `herdweb.config.local.ts`（r1 写错，herdweb 无 dotenv）
  5. systemd unit 生成位置改正到 systemd 正式搜索目录
  6. rescue target 降为 opt-in（r1 的主论证被实测推翻）
  7. 砍掉 `expose.mjs`，职责归还 `herdweb-setup` skill
  8. 新增 **§2.10 与 herdweb-setup skill 的分工**
  9. IPMI 类比降级为「companion service + 故障域矩阵」
  10. 新增 node-pty 原生构建前置条件

## 0. 背景与目标

herdweb 是 herdr 的移动端 Web UI，本 fork **不发布 npm**。当前 README 的安装路径是
`git clone <your-fork-url> && pnpm install && pnpm exec tsx cli.ts serve` —— 等于没有分发路径。

herdr 0.8.x 提供 plugin 机制（https://herdr.dev/docs/plugins/），marketplace
（https://herdr.dev/plugins/）是**全自动索引**：公开 GitHub 仓库打 topic `herdr-plugin`，
仓库内有可解析的 `herdr-plugin.toml` 即收录，30 分钟刷新一次。

本方案的两个目标（用户明确表述）：
1. 降低使用门槛
2. 占住 marketplace 坑位，吸引用户

**目标的优先级约束（r2 新增，用户决策）**：本产品面向能跑终端复用器的极客用户，
**安全优先于门槛**。任何在门槛与安全之间的取舍，一律选安全。

## 1. 已确认的 herdr plugin 机制事实

来源：herdr.dev/docs/plugins/ 全文 + 本机 `herdr 0.8.2` CLI 实测 + r1 评审的实测复核。

- plugin = 目录 + `herdr-plugin.toml` + 任意 argv 命令。无 SDK，整个 herdr CLI 就是 API。
- 安装：`herdr plugin install owner/repo[/subdir]`，仅接受 GitHub shorthand，`git clone` 后
  跑 `[[build]]` 命令，交互式终端下有 preview 确认，`--yes` 可非交互。
- manifest 必填：`id` / `name` / `version` / `min_herdr_version`。herdr 版本低于
  `min_herdr_version` 时拒绝安装或 link。
- 条目类型：`[[build]]` / `[[startup]]` / `[[actions]]` / `[[events]]` / `[[panes]]` /
  `[[link_handlers]]`。
- **`[[startup]]` 是一次性初始化，不是被监管的 daemon**。
- `[[panes]]` placement：`overlay` / `popup` / `split` / `tab` / `zoomed`。
- **keybinding 不在 plugin manifest 里声明**（r1 写错）。`[[keys.command]] type = "plugin_action"`
  属于 herdr 用户自己的 `config.toml`，且只能绑 action，不能绑 pane。
- 注入环境变量：`HERDR_SOCKET_PATH` `HERDR_BIN_PATH` `HERDR_ENV=1` `HERDR_PLUGIN_ID`
  `HERDR_PLUGIN_ROOT` `HERDR_PLUGIN_CONFIG_DIR` `HERDR_PLUGIN_STATE_DIR`
  `HERDR_PLUGIN_CONTEXT_JSON`，以及可用时的 `HERDR_WORKSPACE_ID` / `HERDR_TAB_ID` / `HERDR_PANE_ID`。
  **这些只在 herdr 亲自拉起 plugin command 时注入**——systemd 拉起的进程拿不到（见 §2.9）。
- `HERDR_PLUGIN_ROOT` 是 herdr 托管的 git checkout，**不得存放凭据或持久状态**。
- `[[build]]` 命令**不接收** herdr 运行时上下文和 socket env；herdr 只报构建失败，不装工具链。
- `plugin link`（本地开发）**不跑** build 命令。

### 1.1 r1 评审实测确认的事实（推翻或修正了初稿假设）

| 事实 | 初稿假设 | 实测结果 |
|---|---|---|
| manifest `placement = "popup"` | 疑似 0.8.2 不支持（因 CLI `--help` 无此值） | **0.8.2 支持**，`link` + `pane open` 均返回 `{"type":"ok"}`；`--help` 文案与实际能力不一致，不能拿 help 当版本判据 |
| `npx --yes pnpm@10 install` | 只要 Node 22 即可 | pnpm 免预装成立，但 **`node-pty` 无 prebuild，会走 `node-gyp rebuild`**，实际需要 Python + make + C/C++ 编译器 + Node headers |
| `.env.local` 存密钥 | herdweb 会读 | **不会读**。配置加载只动态导入主配置及同目录 `herdweb.config.local.ts/.js`，无 dotenv。实测报错 `config.asr.doubao.apiKey: expected non-empty string, received redacted` |
| `herdr --session <不存在>` | 会失败，需裸 bash 兜底 | **自动拉起新 server**（tmux 行为），随后 `status server` 为 `running` |
| systemd unit 放 config dir | `systemctl --user enable` 能找到 | **找不到**。`systemctl --user show --property=UnitPath` 不含 plugin config dir |
| `prefix+w` | 可绑 show | **已被 herdr 默认 `workspace_picker` 占用** |
| `herdweb init` 生成的配置 | 含 targets | **不含 targets**，是裸 `export default {}` 且不需 import `defineConfig` |
| 仓库 topics | —— | **当前为空**，marketplace 尚未收录，「占坑位」零进展 |

本仓事实：
- `package.json`：`build:dist = tsdown && pnpm run build:overlay`，`engines.node >= 22`，
  `bin.herdweb = dist/cli.mjs`，版本 1.2.1，**无 `packageManager` 字段**。
- `src/serve.ts` 按端口分隔通知状态目录 —— 换端口不会被现有状态账本识别为同一 herdweb。
- `src/config-schema.ts`：显式 targets 必须设 `defaultTargetId`；两个 target 即进入 explicit 模式
  （手机上出现 target picker）。
- 仓库已有 `scripts/install-prod.sh` 与 `docs/deploy-herdr.md`，其中的 systemd 安装做法是
  正确契约，plugin 应复用而非另造。
- 仓库已有 `.agents/skills/herdweb-setup/SKILL.md`（含 tailscale-serve 等 reference）。

## 2. 核心设计决策与理由

### 2.1 定位：plugin 是 launcher + 门面，不是运行时

herdweb 本体一行不改。plugin 只负责「装上、起来、告诉你怎么连」。

### 2.2 放仓库根目录，不另开仓库

硬理由：`plugin install` 走 `git clone`，若 manifest 放子目录，build 命令的工作目录即该子目录，
而 `pnpm install` 必须在仓库根执行。故只能放根目录。代价是 clone 全历史，判定可接受。

### 2.3 两种运行形态都是一等公民

**曾经的错误推理**（r1 初稿更早的版本）：认为 herdweb 生命周期应绑 herdr server，pane 托管即正解。

**推翻理由**（用户提出）：herdweb 跑在 herdr 的 pane 里会形成**自指死锁** —— 用来远程操控
herdr 的工具自己活在 herdr 里面。手机上一次误操作关掉 tab 或 kill server，救援通道随之消失。

**第一性原理**：救援通道不能依赖被救对象的生命周期。

**r2 修正（IPMI 类比降级）**：systemd 形态是 **companion service，不是带外管理口**。
它跨得过什么、跨不过什么必须写清楚，不能靠类比暗示能力：

| 故障 | service 形态能跨过吗 |
|---|---|
| pane 被关、tab 被关 | ✅ |
| herdr server 退出 / 被 kill | ✅ |
| herdr 客户端连不上 | ✅（herdr 会自动拉起 server，见 §1.1） |
| herdr 二进制损坏 / 启动失败 | ⚠️ 仅当启用 opt-in rescue target（§2.7） |
| Node 损坏、plugin checkout 被删 | ❌ |
| user manager 崩溃、机器重启且未 linger | ❌ |
| 网络不通、端口被占、权限问题 | ❌ |

| 形态 | 定位 | 生命周期 |
|---|---|---|
| pane | herdr 的一个本地透明前端 | 跟 herdr 同生共死（此定位下是特性：可逆、透明、关得掉） |
| systemd / launchd | companion service | 活在 herdr 之外，故障域仍与 host 共享 |

### 2.4 不声明 `[[startup]]`

刻意不写。静默自启一个「能远程控制你终端」的服务，是安全姿态的显著恶化：
一键安装 + 开机静默常驻 + 绑端口 + 远程控制终端，四条凑齐不可接受。
要常驻的人走显式的 `install-service` 流程，由用户自己执行 systemctl 命令。

同理不声明 `[[events]]`（herdweb 已有自己的 push/webhook 通知链，无第二消费者）
和 `[[link_handlers]]`（无用例）。

### 2.5 三类入口分工

因为 keybinding 只能绑 action（且 keybinding 在用户 config.toml 里、不在 manifest），
而 action 的 stdout 只进 plugin 日志（人看不到），所以：

| 入口 | 职责 |
|---|---|
| tab pane | 跑 herdweb 服务本体 |
| popup pane | 显示地址 / 诊断结果 |
| action | 纯触发器，用 `HERDR_BIN_PATH` 去 spawn 对应 pane |

**keybinding 是 opt-in 示例，不是默认旅程**：README 给一段可粘贴的 `[[keys.command]]` 片段，
且**不得用 `prefix+w`**（已被 herdr 默认 `workspace_picker` 占用）。无快捷键路径始终可用：
`herdr plugin action invoke zlxlabs.herdweb.show`。

### 2.6 网络暴露：plugin 永不主动 bind 0.0.0.0（r2 重写）

**用户决策（安全优先）**：砍掉 r1 的 `serve-lan` 便捷入口。

理由：herdweb 无 login / password / ACL，`--host 0.0.0.0` 等于把用户权限下的终端控制面
开放给同一可路由网络的任意设备。r1 给的四条缓和理由（显式触发、临时、pane 可见、随手可关）
**都不是访问控制**，且 herdr pane 在 detach 后继续存活，「临时」并无时间上限。
本产品面向极客用户，多一步手工操作的成本，远低于一个无认证控制面被顺手打开的风险。

修订后的三档：

| 场景 | plugin 提供什么 |
|---|---|
| 同机 | 真一键：install → serve → `http://127.0.0.1:7681` |
| 同一 WiFi | **只显示地址与当前监听状态，不提供开启入口**。要开自己跑 `herdweb serve --host 0.0.0.0`（现有 CLI 能力，风险自负） |
| 出网 | 不提供自动化。`doctor` 报告环境事实，引导用户让 agent 读 `herdweb-setup` skill |

**`show` 的显示契约（关键）**：默认 bind `127.0.0.1` 时局域网地址**不可达**，
只显示地址而不说明状态会误导用户。故 `show` 必须同时给出两项事实：

```
本机     http://127.0.0.1:7681        ← 当前正在监听
局域网   http://192.168.1.23:7681     ← 未监听（herdweb 只绑了 127.0.0.1）
```

只有实际监听非回环地址时，才显示二维码。

### 2.7 rescue target 降为 opt-in（r2 修订）

r1 的主论证被实测推翻：`herdr --session <不存在>` 会自动拉起 server，
所以「server 死了没法救」这个前提不成立。

裸 bash target 仍有价值，但只覆盖窄得多的场景：herdr 二进制损坏、server 启动失败、
需要修配置。而默认启用它有两项实际代价：
1. 配置从 single 变 explicit，手机端凭空多出 target picker
2. 一个无认证 endpoint 多了独立于 herdr 的用户 shell，
   **r1 的「不增加攻击面」说法不成立** —— 它改变了命令可用的生命周期边界

故：**默认不生成 rescue target**。`doctor` 判定 herdr 启动失败时，才提示用户如何临时加上。
README 若写它，必须同时写清权限等价性。

### 2.8 资源账本（r2 新增，收口 P1）

r1 靠「探测 7681 端口」保证单例。这是观察不是锁：check 与 bind 之间有窗口；
端口被占也不能证明占用者是 herdweb，更推不出它在哪个 tab。

**账本定义**：

| 项 | 事实源 |
|---|---|
| 单例作用域 | 同一 user + 同一 network namespace（不宣称 host 级单例） |
| 互斥手段 | `HERDR_PLUGIN_STATE_DIR/herdweb.lock` 上的 `flock`（非阻塞） |
| owner 元数据 | `HERDR_PLUGIN_STATE_DIR/herdweb.owner.json`：`{pid, mode: "pane"\|"service", port, config_path, started_at, herdr_tab_id?}` |
| 端口 | 从生效配置读取，**不硬编码 7681**；owner.json 记录实际值 |
| 冲突归因 | 拿不到锁 → 读 owner.json 报告「谁在跑、什么模式、什么端口」；拿到锁但 bind 失败 → 明确报「端口 N 被非 herdweb 进程占用」 |

**两类失败必须分开报**，不得互相冒充 —— 这是 r1 最严重的缺陷：无关进程占用 7681 时，
r1 会打印「已有 herdweb 在跑，用 show 看地址」，是**错误归因的静默失败**。

启动顺序：取 flock → 读配置定端口 → 写 owner.json → bind → 服务退出时清理 owner.json。
`show` / `doctor` 一律以 owner.json + 实际 listen 结果为事实源，不再自行探端口猜测。

### 2.9 两个 runner 的边界契约（r2 新增，收口 P1）

`HERDR_PLUGIN_*` 变量只在 herdr 拉起 plugin command 时注入。systemd 拉起的进程拿不到。
若不处理，会出现两条路径跑不同配置、只有一条有互斥逻辑的**静默分叉**。

**决定：service 与 pane 跑同一个 runner（`serve.mjs`），差异只在环境如何提供。**

`install-service.mjs` 生成 unit 时，把当前解析到的路径**快照写进 unit 的 `Environment=`**：

```ini
[Service]
Environment=HERDR_PLUGIN_CONFIG_DIR=/home/<user>/.config/herdr/plugins/zlxlabs.herdweb
Environment=HERDR_PLUGIN_STATE_DIR=/home/<user>/.local/state/herdr/plugins/zlxlabs.herdweb
Environment=HERDR_PLUGIN_ROOT=<plugin checkout 路径>
WorkingDirectory=<plugin checkout 路径>
ExecStart=<绝对 node 路径> scripts/plugin/serve.mjs
Restart=on-failure
```

由此两条路径同源：同一份配置、同一把锁、同一个 owner.json。

**代价与配套**：unit 里的路径是生成时快照，plugin 重装（herdr 会替换 managed checkout）
后可能悬空。故 `doctor` 必须检查 unit 中的路径是否仍然存在且指向当前 checkout，
不一致时报 stale。升级/卸载契约见 §2.11。

### 2.10 与 herdweb-setup skill 的分工（r2 新增）

用户洞察：极客用户的实际安装过程很可能是**让自己的 coding agent 代劳**。
本仓已有 `.agents/skills/herdweb-setup/SKILL.md`。故降门槛不该靠 plugin 脚本变聪明：

| 关注点 | 归属 |
|---|---|
| 分发、一行安装、市场曝光、生命周期托管 | **plugin** |
| 可执行的环境探针（输出是事实，人和 agent 都能跑） | **plugin 的 `doctor`** |
| 访谈式配置生成、部署路线选择、Tailscale/Cloudflare 引导 | **herdweb-setup skill** |

据此**砍掉 `expose.mjs`**：它与 skill 的 `references/tailscale-serve.md` 高度重复。
`doctor` 只报告事实（tailscale 装没装、登没登、当前监听什么），末尾指一句
「让你的 agent 读 `.agents/skills/herdweb-setup/SKILL.md`」。

### 2.11 升级 / 卸载契约（r2 新增）

plugin uninstall / reinstall / herdr 升级时的状态迁移必须显式：

- 生成 unit 时同时打印**卸载三件套**：`systemctl --user disable --now herdweb`、
  删除 unit 文件、`daemon-reload`
- `doctor` 检测 stale unit（指向已不存在的 checkout）并给出修复命令
- config 与 state 归 plugin 所有，reinstall 不动它们（herdr 只替换 checkout）
- 卸载 plugin 前若 service 仍在跑，`doctor` 必须报出来 —— 否则会留下占着端口的孤儿进程

## 3. 具体形态

### 3.1 目录

```
herdweb/
  herdr-plugin.toml          ← 新增
  scripts/plugin/            ← 新增
    serve.mjs                  起服务（flock 互斥 + owner.json + 配置引导）
    show.mjs                   显示地址与监听状态（仅在真监听非回环时出二维码）
    doctor.mjs                 环境体检（模式、锁、端口、unit、PWA 五路径、构建前置）
    install-service.mjs        生成 systemd unit / launchd plist 到正式目录并打印命令
    open-pane.mjs              action → pane 的转发器
  （其余一切不动）
```

（`expose.mjs` 已砍，见 §2.10；`serve-lan` 已砍，见 §2.6。）

### 3.2 manifest 草案

```toml
id = "zlxlabs.herdweb"
name = "herdweb"
version = "1.2.1"                     # 版本同步责任见 §5
min_herdr_version = "0.8.2"           # 实测基线；低于此未验证，不宣称支持
description = "Mobile web UI for herdr — localhost only by default, you decide what to expose"
platforms = ["linux", "macos"]

[[build]]
command = ["npx", "--yes", "pnpm@10", "install", "--frozen-lockfile"]
[[build]]
command = ["npx", "--yes", "pnpm@10", "run", "build:dist"]

[[panes]]
id = "serve"
title = "herdweb"
placement = "tab"
command = ["node", "scripts/plugin/serve.mjs"]

[[panes]]
id = "show"
title = "herdweb URL"
placement = "popup"
width = "60%"
height = 24
command = ["node", "scripts/plugin/show.mjs"]

[[panes]]
id = "doctor"
title = "herdweb doctor"
placement = "popup"
width = "80%"
height = 28
command = ["node", "scripts/plugin/doctor.mjs"]

[[panes]]
id = "install-service"
title = "Install herdweb service"
placement = "popup"
width = "80%"
height = 28
command = ["node", "scripts/plugin/install-service.mjs"]

[[actions]]
id = "show"
title = "Show herdweb URL"
contexts = ["workspace"]
command = ["node", "scripts/plugin/open-pane.mjs", "show"]

[[actions]]
id = "start"
title = "Start herdweb"
contexts = ["workspace"]
command = ["node", "scripts/plugin/open-pane.mjs", "serve"]
```

`min_herdr_version` 从 r1 的 `0.8.0` 改为 `0.8.2`：0.8.2 是唯一实测过的版本，
声称支持未验证的更低版本没有依据。

### 3.3 脚本职责

**serve.mjs**
1. 取 `HERDR_PLUGIN_STATE_DIR/herdweb.lock` 的 flock（非阻塞）；失败则读 owner.json，
   报告「谁在跑 / 什么模式 / 什么端口」并退出
2. `HERDR_PLUGIN_CONFIG_DIR` 无 `herdweb.config.ts` 则生成默认配置
   （**不含 rescue target**，见 §2.7）
3. 从生效配置解析端口，写 owner.json
4. `exec node dist/cli.mjs serve --config $HERDR_PLUGIN_CONFIG_DIR/herdweb.config.ts`；
   bind 失败明确报「端口被非 herdweb 进程占用」
5. 退出时清理 owner.json

**show.mjs** —— 以 owner.json + 实际 listen 结果为事实源，按 §2.6 的显示契约输出
本机地址与局域网地址各自的监听状态；仅在真监听非回环时出二维码。

**doctor.mjs** —— 报告事实，不做决定：
- 当前模式（`pane` / `service` / `none`）、锁持有者、实际端口与监听地址
- service 模式下：unit 是否在正式搜索目录、`loginctl enable-linger` 是否开启、
  unit 内路径是否 stale（§2.9）
- 构建前置：Node 版本、Python / make / C++ 编译器是否具备（§2.12）
- **实际请求 `/manifest.json` `/sw.js` `/icon-192.png` `/icon-512.png` `/apple-touch-icon.png`**，
  判断返回的是 JSON/图标还是登录页重定向 —— 把 README FAQ 里那条 Cloudflare Access + PWA
  的坑变成能跑的检查
- 末尾指向 `herdweb-setup` skill

**install-service.mjs** —— 按 §2.9 生成 unit 到 systemd 正式搜索目录
（`${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user`，复用 `scripts/install-prod.sh` 的既有做法），
macOS 生成 launchd plist；打印安装、`daemon-reload`、enable、linger 与**卸载三件套**命令，
**执行的是用户**。

### 3.4 配置与状态位置（r2 更正）

- `HERDR_PLUGIN_CONFIG_DIR/herdweb.config.ts` —— 主配置
- `HERDR_PLUGIN_CONFIG_DIR/herdweb.config.local.ts` —— **密钥**（voice / push）。
  r1 写的 `.env.local` 是错的，herdweb 没有 dotenv 加载路径（见 §1.1）
- `HERDR_PLUGIN_STATE_DIR/herdweb.lock`、`herdweb.owner.json` —— 运行时账本（§2.8）
- `HERDR_PLUGIN_ROOT` 什么都不放

### 3.5 用户旅程

```bash
herdr plugin install zlxlabs/herdweb              # clone + build，安装前 preview 可审
herdr plugin action invoke zlxlabs.herdweb.start  # 开 tab 跑起来
# 同机：浏览器开 http://127.0.0.1:7681
# 想看状态/地址：herdr plugin pane open --plugin zlxlabs.herdweb --entrypoint show
# 想常驻：开 install-service popup → 照给的命令自己跑
# 想从手机连：让 agent 读 .agents/skills/herdweb-setup/SKILL.md
```

### 3.6 安全模型补充（写进 README）

- plugin 默认只监听 `127.0.0.1`，且**不提供任何一键对外暴露的入口**
- 能访问 herdweb 的人 ≈ 拥有你的用户权限（README 已有此条，需在 plugin 一节重申）
- rescue target 默认关闭；启用它等于在无认证 endpoint 上开一个独立于 herdr 的 shell

## 4. 写码前必须补的实测

r1 verdict 列出 8 项，全部采纳。按能否推翻设计排序：

1. **端口/锁组合矩阵**：无关进程占用、两次并发启动、service 重启空窗、手工 `--port`、
   不同 named session、不同 user、容器 namespace。每例都要记录监听 owner、实际 URL、
   service 状态与 `show`/`doctor` 的归因是否正确 —— 不能只记「端口开了」
2. **service unit 真实启动**：unit 在正式目录、`daemon-reload` 后能起、Restart 行为、
   无交互 PATH、`Environment=` 注入是否让 `serve.mjs` 拿到全部路径、linger、
   卸载与 reinstall 后的清理
3. **配置矩阵**：`.ts` / `.js` / `.local.ts` / `.local.js` / 已有坏配置 / 已有配置再次启动。
   断言最终生效的 target、secret 与 source label；特别验证生成器不会在已有 `.js` 时
   只检查 `.ts` 就覆盖或旁路配置
4. **干净环境 build**：只有 Node 22，分别缺 Python / 缺编译器 / 缺 Node headers / 离线。
   记录 `plugin install` 的最终输出、残留 checkout、registry 是否注册
5. **完整 manifest 行为**：在 0.8.2 跑 link、action invoke、pane open，覆盖 popup、尺寸、
   tab、多 build、platforms、disabled plugin、无活动 workspace 的 action
6. **多上下文 action**：从两个 named session、普通终端、无活动 client 分别触发同一 action，
   断言 `HERDR_BIN_PATH`、socket、workspace/tab/pane context 的实际值，
   popup 是否开在触发它的 session，action 的 stdout/stderr 如何进 log、失败是否回显
7. **PWA 五路径**：在有认证代理与无代理两种情形下验证 doctor 的判定正确
8. **marketplace 收录**：打 topic 后确认 manifest 被索引、显示的版本/路径/commit 正确

## 5. 落地拆卡预估

- **卡零（S，可立即做，与方案定稿无关）**：给仓库打 GitHub topic `herdr-plugin`。
  当前 topics 为空，占坑位零进展。
- **卡一（M）**：`herdr-plugin.toml` + `scripts/plugin/` 五个脚本，含 §2.8 资源账本与
  §2.9 边界契约；同时完成 §4 第 1、3 项实测
- **卡二（M）**：§4 第 2、4 项实测（systemd 真实启动 + 干净环境 build 矩阵），
  按结果补 doctor 的前置检查
- **卡三（S）**：README plugin 一节 + §3.6 安全模型补充 + keybinding opt-in 示例
  （不得用 `prefix+w`）+ marketplace 文案

**版本同步责任**：`herdr-plugin.toml` 的 `version` 与 `package.json` 由 semantic-release
管理的版本必须一致，需一条 CI 检查锁死，否则 marketplace 展示的元数据会陈旧。

## 6. r1 verdict 的处置对照

| r1 finding | 工具标注 | 本仓判定 | 处置 |
|---|---|---|---|
| `.env.local` 不被读取 | P1 | P1 | 已改 §3.4 → `herdweb.config.local.ts` |
| 探端口不是单例互斥 | P1 | P1 | 已加 §2.8 资源账本 |
| `serve-lan` 无认证暴露 | P1 | P1 | **已砍**，见 §2.6（用户决策） |
| service 拿不到 `HERDR_PLUGIN_*` | P2 | **提 P1** | 已加 §2.9 边界契约 |
| systemd unit 路径错 | P2 | P2 | 已改 §3.3，复用 `install-prod.sh` 做法 |
| node-pty 原生构建前置 | P2 | P2 | 已记 §1.1、§3.3 doctor 检查、§4 第 4 项 |
| `prefix+w` 冲突 | P2 | P2 | 已改 §2.5，keybinding 降为 opt-in 示例 |
| rescue 必要性被夸大 | P2 | P2 | 已改 §2.7，降为 opt-in |
| 升级/卸载契约缺失 | P2 | P2 | 已加 §2.11 |
| IPMI 类比过强 | P2 | P3 | 已降级为故障域矩阵，见 §2.3 |
| pnpm 版本不锁 | P3 | P3 | backlog：构建契约里写明版本策略 |
| manifest 版本不同步 | P3 | P3 | 已记 §5，需 CI 检查 |
