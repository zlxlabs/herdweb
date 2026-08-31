# 方案：把 herdweb 做成 herdr plugin

状态：待评审草案（未落 git，未拆卡）。日期 2026-08-31。

## 0. 背景与目标

herdweb 是 herdr 的移动端 Web UI，本 fork **不发布 npm**。当前 README 的安装路径是
`git clone <your-fork-url> && pnpm install && pnpm exec tsx cli.ts serve` —— 等于没有分发路径。

herdr 0.8.x 提供 plugin 机制（https://herdr.dev/docs/plugins/），marketplace
（https://herdr.dev/plugins/）是**全自动索引**：公开 GitHub 仓库打 topic `herdr-plugin`，
仓库内有可解析的 `herdr-plugin.toml` 即收录，30 分钟刷新一次。

本方案的两个目标（用户明确表述）：
1. 降低使用门槛
2. 占住 marketplace 坑位，吸引用户

## 1. 已确认的 herdr plugin 机制事实

来源：herdr.dev/docs/plugins/ 全文 + 本机 `herdr 0.8.2` CLI 实测。

- plugin = 目录 + `herdr-plugin.toml` + 任意 argv 命令。无 SDK，整个 herdr CLI 就是 API。
- 安装：`herdr plugin install owner/repo[/subdir]`，仅接受 GitHub shorthand，`git clone` 后
  跑 `[[build]]` 命令，交互式终端下有 preview 确认，`--yes` 可非交互。
- manifest 必填：`id` / `name` / `version` / `min_herdr_version`。herdr 版本低于
  `min_herdr_version` 时拒绝安装或 link。
- 条目类型：`[[build]]` / `[[startup]]` / `[[actions]]` / `[[events]]` / `[[panes]]` /
  `[[link_handlers]]`。
- **`[[startup]]` 是一次性初始化，不是被监管的 daemon**（文档原文：
  "Startup hooks are one-shot initialization commands rather than supervised daemons"）。
- `[[panes]]` placement：`overlay`（默认，临时 zoom 覆盖）/ `popup`（session-modal 弹窗，
  接收 Escape，命令退出即关）/ `split` / `tab` / `zoomed`。
- **keybinding 只能绑 action**：`[[keys.command]] type = "plugin_action"`。文档未提供绑 pane 的类型。
- 注入环境变量：`HERDR_SOCKET_PATH` `HERDR_BIN_PATH` `HERDR_ENV=1` `HERDR_PLUGIN_ID`
  `HERDR_PLUGIN_ROOT` `HERDR_PLUGIN_CONFIG_DIR` `HERDR_PLUGIN_STATE_DIR`
  `HERDR_PLUGIN_CONTEXT_JSON`，以及可用时的 `HERDR_WORKSPACE_ID` / `HERDR_TAB_ID` / `HERDR_PANE_ID`。
- `HERDR_PLUGIN_ROOT` 是 herdr 托管的 git checkout，**不得存放凭据或持久状态**；
  用户配置放 `HERDR_PLUGIN_CONFIG_DIR`，运行时状态放 `HERDR_PLUGIN_STATE_DIR`。
- `[[build]]` 命令**不接收** herdr 运行时上下文和 socket env；herdr 只报构建失败，不装工具链。
- `plugin link`（本地开发）**不跑** build 命令。

本机实测差异（重要）：
- `herdr 0.8.2` 的 `herdr plugin pane open --placement` 可选值只有
  `overlay, split, tab, zoomed` —— **不含 `popup`**。文档描述 popup 且给了 manifest 示例，
  疑似 popup 为 0.8.2 之后引入，或仅支持 manifest 声明而不支持 CLI 覆盖。**待实测**。

本仓事实：
- `package.json`：`build:dist = tsdown && pnpm run build:overlay`，`engines.node >= 22`，
  `bin.herdweb = dist/cli.mjs`，版本 1.2.1。
- **无 `packageManager` 字段**。
- `build:dist` 链不依赖 mise / typos（CLAUDE.md 记录 `ci-check` 才依赖 typos）。
- README targets 配置示例是裸 `export default { ... }` 对象，不 import `defineConfig`。

## 2. 核心设计决策与理由

### 2.1 定位：plugin 是 launcher + 门面，不是运行时

herdweb 本体一行不改。plugin 只负责「装上、起来、告诉你怎么连」。

### 2.2 放仓库根目录，不另开仓库

硬理由：`plugin install` 走 `git clone`，若 manifest 放子目录，build 命令的工作目录即该子目录，
而 `pnpm install` 必须在仓库根执行。故只能放根目录。

代价：clone 全历史，体积大于纯脚本 plugin。判定为可接受。

### 2.3 两种运行形态都是一等公民（关键决策）

**曾经的错误推理**（第一版方案）：认为 herdweb 生命周期应绑 herdr server，pane 托管即正解，
systemd 只是「老手的附录」。

**推翻理由**（用户提出）：herdweb 跑在 herdr 的 pane 里会形成**自指死锁** —— 用来远程操控
herdr 的工具自己活在 herdr 里面。手机上一次误操作关掉 tab 或 kill server，救援通道随之消失，
人在外面无法自救。

**修正后的第一性原理**：救援通道不能依赖被救对象的生命周期（同告警系统不能跑在被告警服务里、
带外管理口 IPMI 不依赖 OS 存活）。herdr server 死掉的时刻，恰恰是 herdweb 最需要活着的时刻。

**修正后的分类**：

| 形态 | 定位 | 生命周期 |
|---|---|---|
| pane | herdr 的一个前端 | 跟 herdr 同生共死（此定位下是特性：可逆、透明、关得掉） |
| systemd / launchd | 这台机器的**带外管理口** | 必须活在 herdr 之外 |

两种形态都要支持，systemd 是主路而非附录。

### 2.4 不声明 `[[startup]]`

刻意不写。静默自启一个「能远程控制你终端」的服务，是安全姿态的显著恶化：
一键安装 + 开机静默常驻 + 绑端口 + 远程控制终端，四条凑齐不可接受。
要常驻的人走显式的 `install-service` 流程，由用户自己执行 systemctl 命令。

同理不声明 `[[events]]`（herdweb 已有自己的 push/webhook 通知链，无第二消费者）
和 `[[link_handlers]]`（无用例）。

### 2.5 三类入口分工

因为 keybinding 只能绑 action，而 action 的 stdout 只进 plugin 日志（人看不到），所以：

| 入口 | 职责 | 理由 |
|---|---|---|
| tab pane | 跑 herdweb 服务本体 | 长驻、要日志、独占一个 tab |
| popup pane | 显示二维码 / 诊断结果 / 暴露引导 | 有终端能显示，Escape 即关，不动布局 |
| action | 纯触发器，自己去 spawn 对应 pane | 唯一能绑快捷键的东西 |

链路：`prefix+w` → action `show` → spawn popup 显示二维码 → 扫完 Escape。

### 2.6 远程访问：放弃「一键」，改追「零思考」

远程访问需要**外部信任根**（Tailscale 账号/authkey、Cloudflare 域名/tunnel token/Access 策略），
这些是用户的身份与资产，herdweb 拿不到也不该拿。任何「一键公网暴露」都意味着代持凭据或
替用户做安全决策 —— 对终端远程控制面而言不可接受。

因此自动化程度有硬上限，但**认知负担**仍有很大压缩空间。分三档，每档做到各自上限：

| 场景 | 目标 |
|---|---|
| 同机试用 | 真一键：install → serve → localhost:7681，零外部依赖 |
| 同一 WiFi | 接近一键：`--host 0.0.0.0` + 局域网 IP + 二维码，不需要任何信任根 |
| 出网 | 不能一键，但做到「不用读文档」：探测环境、打印参数已填好的命令、标出已知的坑 |

对外话术：「同机、同网一键。出网那段我们帮你查环境、给你确切的命令、把已知的坑标出来 ——
但按下确认的必须是你。」

**已识别张力**：第二档给 `--host 0.0.0.0` 做便捷入口，与 README 现有安全模型
（「只有明确想要网络暴露且有独立网络控制时才用」）存在张力。判定为可接受，理由是它
显式触发、临时、pane 里看得见、随手关得掉 —— 与被否决的静默 daemon 的区别正在这四点。
前提：pane 启动时必须在顶部打印风险提示。

### 2.7 救援 target

即使 herdweb 以 systemd 形态活着，它内部的 `herdr --session default` 也可能因 server 已死而失效。
故默认生成的配置里加一个不依赖 herdr 的裸 shell target：

```typescript
targets: [
  { id: 'local',  name: 'Local',        command: ['herdr', '--session', 'default'] },
  { id: 'rescue', name: 'Rescue shell', command: ['bash', '-l'] },
]
```

herdr 完全挂掉时，手机上切到 Rescue shell 得到裸 bash，手动敲 `herdr` 拉起。救援链路闭环。
herdweb 零改动 —— targets 本就是任意 spawn 命令。

安全上不增加攻击面：herdr pane 本来就能跑任何命令。但 README 安全模型需明写
「能进 herdweb ≈ 拥有你的用户权限」。

## 3. 具体形态

### 3.1 目录

```
herdweb/
  herdr-plugin.toml          ← 新增
  scripts/plugin/            ← 新增
    serve.mjs                  起服务（含端口/单例互斥检查）
    show.mjs                   打印 URL + 二维码
    doctor.mjs                 环境体检
    expose.mjs                 出网引导
    install-service.mjs        生成 systemd unit / launchd plist 并打印命令
    open-pane.mjs              action → pane 的转发器
  （其余一切不动）
```

### 3.2 manifest 草案

```toml
id = "zlxlabs.herdweb"
name = "herdweb"
version = "1.2.1"
min_herdr_version = "0.8.0"          # 待实测确认
description = "Mobile web UI for herdr — localhost by default, you decide what to expose"
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
id = "serve-lan"
title = "herdweb (LAN)"
placement = "tab"
command = ["node", "scripts/plugin/serve.mjs", "--lan"]

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
id = "expose"
title = "Expose herdweb"
placement = "popup"
width = "80%"
height = 28
command = ["node", "scripts/plugin/expose.mjs"]

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

（无 `[[startup]]`、无 `[[events]]`、无 `[[link_handlers]]`，理由见 2.4。）

### 3.3 脚本职责

**serve.mjs**（最关键）
1. `HERDR_PLUGIN_CONFIG_DIR` 无 `herdweb.config.ts` 则生成默认配置（含 rescue target），
   等于内联了 `herdweb init`
2. 探测 7681 端口：
   - 已被 systemd 常驻实例占用 → 打印「已有常驻实例在跑，用 show 看地址」并退出（不报端口冲突）
   - 已被另一个 pane 实例占用 → 打印所在 tab 并退出
   - **任何时候只有一个 herdweb 实例，且用户随时知道是哪种模式**
3. 打印访问信息 + 二维码；`--lan` 模式额外打印风险提示
4. `exec node dist/cli.mjs serve --config $HERDR_PLUGIN_CONFIG_DIR/herdweb.config.ts`

**show.mjs** —— 读端口与当前模式，打 URL + 二维码，等按键退出。

**doctor.mjs** —— 第一行报当前模式：`pane` / `service` / `both(冲突)` / `none`；
service 模式下额外检查 `loginctl enable-linger` 是否开启（漏了会在关键时刻失效）；
node 版本；端口占用；**实际请求 `/manifest.json` `/sw.js` `/icon-192.png` `/icon-512.png`
`/apple-touch-icon.png` 五个路径，判断返回的是 JSON/图标还是登录页重定向** ——
把 README FAQ 里那条 Cloudflare Access + PWA 的坑变成能跑的检查。

**expose.mjs** —— 探测 tailscale 是否安装/是否已登录、cloudflared 是否存在，
打印参数已填好的那一条命令（如 `tailscale serve --bg 7681`），**不替用户执行**。

**install-service.mjs** —— 生成 systemd user unit（macOS 生成 launchd plist）到 config dir，
把命令打在屏幕上让用户自己跑：
```
systemctl --user enable --now herdweb
loginctl enable-linger $USER      # 没这行，退出登录即停
```
我们生成、我们解释，执行的是用户。

### 3.4 配置与状态位置

- `HERDR_PLUGIN_CONFIG_DIR/herdweb.config.ts` —— 主配置
- `HERDR_PLUGIN_CONFIG_DIR/.env.local` —— voice / push 密钥
- `HERDR_PLUGIN_ROOT` 什么都不放（herdr 托管的 checkout，重装即覆盖）

### 3.5 用户旅程

```bash
herdr plugin install zlxlabs/herdweb              # clone + build，安装前 preview 可审
herdr plugin action invoke zlxlabs.herdweb.start  # 开 tab 跑起来
# 同机：浏览器开 localhost:7681
# 同 WiFi：prefix+w → popup 二维码 → 手机扫
# 出网：开 expose popup → 照给的命令跑
# 要常驻：开 install-service popup → 照给的命令跑
```

## 4. 待实测的不确定点

1. **`placement = "popup"` 在目标 herdr 版本是否可用** —— 本机 0.8.2 的
   `plugin pane open --placement` 不含 popup。跑不通则降级用 `overlay`（同样临时、
   关闭恢复焦点，语义接近）。`min_herdr_version` 的取值取决于此结果。
2. **build 链能否在裸 node 环境跑通** —— 本仓无 `packageManager` 字段，
   `npx --yes pnpm@10 install --frozen-lockfile` 能否吃下现有 lockfile。
   走 npx 是为了不要求用户预装 pnpm，是降门槛的关键一环。
3. **`--config` 指向 config dir 的 `.ts` 文件能否被正确加载** —— README 示例是裸
   `export default {}` 不 import `defineConfig`，大概率无问题，但需真跑一次。
4. **`herdr --session default` 在 server 不存在时的行为** —— 自动拉起新 server（tmux 行为）
   还是报错退出？决定救援链路是否自愈，以及 README 里操作顺序怎么写。

## 5. 落地拆卡预估

- 卡一（M）：`herdr-plugin.toml` + `scripts/plugin/` 六个脚本 + 实测四个不确定点
- 卡二（S）：README 新增 plugin 安装一节 + 安全模型补「能进 herdweb ≈ 拥有你的用户权限」
  + 市场卡片文案 + 打 GitHub topic `herdr-plugin`
