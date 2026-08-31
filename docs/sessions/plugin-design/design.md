# 方案：把 herdweb 做成 herdr plugin

状态：**r4**，实现已合入主干。经两轮独立评审 + 两轮真机实测 + 一次真实 `plugin install` 验证。
日期 2026-09-01。

相关记录：
- 方案评审：`docs/sessions/plugin-design/reviews/plugin-design-verdict.md`（暂不通过）
- 实现评审 r1：`docs/sessions/plugin-design/reviews/plugin-core-verdict.md`（FAIL，1 P1 + 4 P2）
- 实现评审 r2：`docs/sessions/plugin-design/reviews/plugin-core-verdict-r2.md`（PASS，无新增 P1）
- 实测：`docs/sessions/plugin-design/probes/build-matrix.md`（干净机器构建门槛）
- 实测：`docs/sessions/plugin-design/probes/runtime-matrix.md`（flock 账本 × herdr 运行时）

## 修订记录

- **r1**（初稿）：主脑与用户四轮对话产出。
- **r2**：按 r1 verdict 的 4 条 P1 + 用户对 LAN 入口的决策修订。砍掉 `serve-lan`、
  新增资源账本与 runner 边界契约、改正密钥路径与 systemd unit 位置、rescue 降 opt-in。
- **r3**（本版）：按两份真机实测矩阵修订，并确定构建门槛的处理方案。主要变更：
  1. **构建门槛定为方案 A**：接受 Linux 需本地编译，用**前置检查**把失败提前到一个输出极短的步骤（§2.12）
  2. §2.8 资源账本三处改正，其中「锁文件永不 unlink」是实测发现的**正确性漏洞**
  3. §2.9 写明 systemd 重启的锁空窗；卸载改四件套；stale 判据具体化
  4. §2.5 定死 **action 只能当触发器**——实测 `plugin action invoke` 恒 EXIT 0 且不回显
  5. §1.1 修正「`herdr --session <新名字>` 自动拉 server」——仅 TUI 入口成立
  6. §4 待实测大幅收敛：已测的移出，只留真未测成的
- **r4**（本版）：实现落地（PR #155）后按两轮实现评审与真实安装验证修订。主要变更：
  1. **§2.8 锁语义改正**：锁的持有者是**实际提供服务的进程**，runner 死 ≠ 锁释放（r1 P1 的修复改变了这条）
  2. **§2.8 新增 INV-SVC 不变式**：锁必须覆盖「服务行为」，不只是「账本写入」
  3. §3.3 的 `exec` 改为 **spawn + 把 lock fd 传给 child**，并说明为什么
  4. §2.12 前置检查改为**全平台**校验 flock 能力（python3 或 perl）
  5. **端口那条是设计写错了**：herdweb 的 config schema 是 strict object，没有 `port` 字段，
     「从生效配置读取端口」不可实现 —— 改为 `HERDWEB_PLUGIN_PORT`，非法值 fail-loud
  6. 新增 §7 backlog（评审接受不修的 P2/P3）

## 0. 背景与目标

herdweb 是 herdr 的移动端 Web UI，本 fork **不发布 npm**。当前 README 的安装路径是
`git clone <your-fork-url> && pnpm install && pnpm exec tsx cli.ts serve` —— 等于没有分发路径。

herdr 0.8.x 提供 plugin 机制（https://herdr.dev/docs/plugins/），marketplace
（https://herdr.dev/plugins/）是**全自动索引**：公开 GitHub 仓库打 topic `herdr-plugin`，
仓库内有可解析的 `herdr-plugin.toml` 即收录，30 分钟刷新一次。
**topic 已于 2026-08-31 打上**；manifest 落地后即会被索引。

本方案的两个目标（用户明确表述）：
1. 降低使用门槛
2. 占住 marketplace 坑位，吸引用户

**优先级约束（用户决策）**：本产品面向能跑终端复用器的极客用户，
**安全优先于门槛**。任何在门槛与安全之间的取舍，一律选安全。

## 1. 已确认的 herdr plugin 机制事实

来源：herdr.dev/docs/plugins/ 全文 + 本机 `herdr 0.8.2` 实测 + r1 评审 + 两份实测矩阵。

- plugin = 目录 + `herdr-plugin.toml` + 任意 argv 命令。无 SDK，整个 herdr CLI 就是 API。
- 安装：`herdr plugin install owner/repo[/subdir]`，仅接受 GitHub shorthand，`git clone` 后
  按顺序跑 `[[build]]` 命令，**任一条失败即中止 install 且不注册 plugin**，
  交互式终端下有 preview 确认。
- manifest 必填：`id` / `name` / `version` / `min_herdr_version`。
- **`[[startup]]` 是一次性初始化，不是被监管的 daemon**。
- `[[panes]]` placement：`overlay` / `popup` / `split` / `tab` / `zoomed`。
- **keybinding 不在 plugin manifest 里声明**，属于 herdr 用户自己的 `config.toml`，
  且只能绑 action，不能绑 pane。
- `HERDR_PLUGIN_*` 变量**只在 herdr 亲自拉起 plugin command 时注入**；
  systemd 拉起的进程拿不到（见 §2.9）。
- `HERDR_PLUGIN_ROOT` 是 herdr 托管的 git checkout，**不得存放凭据或持久状态**。
- `[[build]]` 命令**不接收** herdr 运行时上下文和 socket env；herdr 只报构建失败，不装工具链。
- `plugin link`（本地开发）**不跑** build 命令。注意 `link --enabled PATH` 会把 PATH
  当选项值报错；直接 `link PATH`，link 后即为 enabled。

### 1.1 实测确认的事实（推翻或修正了先前假设）

| 事实 | 先前假设 | 实测结果 | 出处 |
|---|---|---|---|
| `node-pty@1.1.0` 预编译 | 只要 Node 22 即可 | 包内 `prebuilds/` **只有 darwin-arm64 / darwin-x64 / win32-x64 / win32-arm64，没有任何 linux-\***。Linux 必然 `node-gyp rebuild` | build p1 |
| Linux 干净机安装 | 能装 | `node:22-slim`、`node:22-alpine` 均**失败**（缺 Python）；补 `python3 make g++` 或用完整 `node:22` 则成功 | build 1/2/3/4 |
| `npm_config_build_from_source=false` | 可能绕开编译 | **无效**。node-pty 用自定义 `prebuild.js`，不读该变量 | build 5 |
| `--ignore-scripts` | 可能绕开编译 | install 与 `build:dist` 都成功、`dist/` 有产物，但 `require('node-pty')` **失败** ——「构建通过 ≠ 运行可用」 | build s1 |
| `.env.local` 存密钥 | herdweb 会读 | **不会读**，无 dotenv 加载路径 | r1 verdict |
| `herdr --session <不存在>` | 一律自动拉起 server | **仅 TUI 入口成立**。`plugin action invoke` 报 `server_not_running`；无 tty 跑 TUI 客户端会 panic 但 server 仍起来 | runtime D13 |
| `plugin action invoke` 的失败可见性 | 可当错误通道 | **恒 EXIT 0**，`status=running`，不回显 stdout/stderr；失败只在**该 session 自己的** `plugin log list` | runtime D14 |
| 非阻塞 flock | 假设可用 | 成立，第二个确定性失败 | runtime A1 |
| 持锁进程被 SIGKILL | owner.json 残留是正确性缺口 | **不是**。内核立刻释放 flock，后来者获锁成功；获锁本身就证明可无条件覆写 | runtime A2 |
| 锁文件被 unlink | 未考虑 | **正确性漏洞**：持锁进程仍握 fd 时删锁文件，后来者对同路径 open 得到新 inode 并再次获锁 → 双持有 | runtime A3 |
| systemd `Restart=on-failure` | 假设互斥连续 | `RestartSec=1` 时锁空窗约 **1.1s**，pane 可在窗口内抢锁 | runtime C8 |
| plugin config/state 目录作用域 | 疑似按 session | **跨 named session 相同**（socket 和 workspace/tab 才按 session）→ 作用域是 user × plugin id | runtime D13 |
| `Environment=` 注入 | 假设可行 | 成立，unit 注入的 `HERDR_PLUGIN_*` 出现在进程 `printenv` | runtime C7 |
| manifest `placement = "popup"` | 疑似 0.8.2 不支持 | **支持**（CLI `--help` 文案与实际能力不一致）；popup 开在**触发它的 session**，且不是 herdr pane（无 `HERDR_PANE_ID`） | r1 verdict、runtime D16 |
| systemd unit 放 config dir | 能加载 | **找不到**，`systemctl --user` 搜索路径不含该目录 | r1 verdict |
| `prefix+w` | 可绑 show | 已被 herdr 默认 `workspace_picker` 占用 | r1 verdict |
| `herdweb init` 生成的配置 | 含 targets | **不含 targets**，裸 `export default {}`，不需 import `defineConfig` | r1 verdict |

本仓事实：
- `build:dist = tsdown && pnpm run build:overlay`（成功时约 4s），`engines.node >= 22`，
  `bin.herdweb = dist/cli.mjs`，**无 `packageManager` 字段**。
- 有 install/postinstall 脚本的依赖：`node-pty`（gyp 编译）、`@biomejs/biome`、
  两份 `esbuild`（下载官方二进制）。**只有 node-pty 需要本地编译**。
- `src/serve.ts` 按端口分隔通知状态目录 —— 换端口不会被现有状态账本识别为同一 herdweb。
- `src/config-schema.ts`：显式 targets 必须设 `defaultTargetId`；两个 target 即进入 explicit
  模式（手机上出现 target picker）。
- 仓库已有 `scripts/install-prod.sh` 与 `docs/deploy-herdr.md`（systemd 安装的正确做法），
  以及 `.agents/skills/herdweb-setup/SKILL.md`。
- backlog：`pnpm-workspace.yaml` 的 `allowBuilds` 是 pnpm 11 字段，本链用 pnpm@10，未生效。

## 2. 核心设计决策与理由

### 2.1 定位：plugin 是 launcher + 门面，不是运行时

herdweb 本体一行不改。plugin 只负责「装上、起来、告诉你怎么连」。

### 2.2 放仓库根目录，不另开仓库

`plugin install` 走 `git clone`，若 manifest 放子目录，build 命令的工作目录即该子目录，
而 `pnpm install` 必须在仓库根执行。故只能放根目录。代价是 clone 全历史，判定可接受。

### 2.3 两种运行形态都是一等公民

**推翻过的推理**：曾认为 herdweb 生命周期应绑 herdr server、pane 托管即正解。
用户指出这会形成**自指死锁** —— 用来远程操控 herdr 的工具自己活在 herdr 里面，
手机上一次误操作关掉 tab 或 kill server，救援通道随之消失。

**第一性原理**：救援通道不能依赖被救对象的生命周期。

**能力边界（不用 IPMI 类比）**：systemd 形态是 companion service，故障域仍与 host 共享：

| 故障 | service 形态能跨过吗 |
|---|---|
| pane 被关、tab 被关 | ✅ |
| herdr server 退出 / 被 kill | ✅ |
| herdr 客户端连不上 | ✅（herdweb 在 PTY 里跑 `herdr --session …`，属 TUI 入口，会自动拉起 server） |
| herdr 二进制损坏 / 启动失败 | ⚠️ 仅当启用 opt-in rescue target（§2.7） |
| Node 损坏、plugin checkout 被删 | ❌ |
| user manager 崩溃、机器重启且未 linger | ❌ |
| 网络不通、端口被占、权限问题 | ❌ |

### 2.4 不声明 `[[startup]]`

刻意不写。一键安装 + 开机静默常驻 + 绑端口 + 远程控制终端，四条凑齐不可接受。
要常驻的人走显式的 `install-service` 流程，由用户自己执行 systemctl 命令。

同理不声明 `[[events]]`（herdweb 已有自己的 push/webhook 通知链，无第二消费者）
和 `[[link_handlers]]`（无用例）。

### 2.5 三类入口分工（r3 收紧）

| 入口 | 职责 |
|---|---|
| tab pane | 跑 herdweb 服务本体 |
| popup pane | 显示地址 / 诊断结果（开在触发它的 session） |
| action | **纯触发器**，用 `HERDR_BIN_PATH` 去 spawn 对应 pane |

**action 绝不能当错误通道**（实测 D14）：`plugin action invoke` 恒返回 EXIT 0、
`status=running`、不回显脚本 stdout/stderr；失败只落在**该 session 自己的**
`plugin log list`（`plugin log list` 不带 `--session` 只看 default server）。

由此定死两条：
- action 脚本自身必须尽量不可能失败——它只做一件事：spawn pane
- **一切用户需要看到的信息（包括错误）都必须出现在 pane/popup 里**

**keybinding 是 opt-in 示例**：README 给可粘贴的 `[[keys.command]]` 片段，
**不得用 `prefix+w`**（已被 `workspace_picker` 占用）。
无快捷键路径始终可用：`herdr plugin action invoke zlxlabs.herdweb.show`。

### 2.6 网络暴露：plugin 永不主动 bind 0.0.0.0

**用户决策（安全优先）**：不提供任何一键对外暴露的入口。

herdweb 无 login / password / ACL，`--host 0.0.0.0` 等于把用户权限下的终端控制面
开放给同一可路由网络的任意设备。「显式触发、临时、可见、可关」**都不是访问控制**，
且 herdr pane 在 detach 后继续存活，「临时」并无时间上限。

| 场景 | plugin 提供什么 |
|---|---|
| 同机 | 真一键：install → serve → `http://127.0.0.1:7681` |
| 同一 WiFi | **只显示地址与当前监听状态，不提供开启入口**。要开自己跑 `herdweb serve --host 0.0.0.0`（风险自负） |
| 出网 | 不提供自动化。`doctor` 报告环境事实，引导用户让 agent 读 `herdweb-setup` skill |

**`show` 的显示契约**：默认 bind `127.0.0.1` 时局域网地址不可达，只显示地址会误导。
必须同时给出监听状态：

```
本机     http://127.0.0.1:7681        ← 当前正在监听
局域网   http://192.168.1.23:7681     ← 未监听（herdweb 只绑了 127.0.0.1）
```

只有实际监听非回环地址时，才显示二维码。

### 2.7 rescue target 降为 opt-in

`herdr --session <不存在>` 在 **TUI 入口**下会自动拉起 server，而 herdweb 正是在 PTY 里
跑这条命令，所以「server 死了没法救」这个前提不成立。
（注意区别：`plugin action invoke` 这类 CLI 子命令**不会**拉起 server。）

裸 bash target 只覆盖窄得多的场景：herdr 二进制损坏、server 启动失败、需要修配置。
默认启用它有两项代价：配置从 single 变 explicit（手机端凭空多出 target picker）；
一个无认证 endpoint 多了独立于 herdr 的用户 shell（改变了命令可用的生命周期边界，
「不增加攻击面」的说法不成立）。

故：**默认不生成 rescue target**。`doctor` 判定 herdr 启动失败时才提示如何临时加上。

### 2.8 资源账本（r3 改正三处）

不靠探端口。观察不是锁：check 与 bind 之间有窗口；端口被占也不能证明占用者是 herdweb。

| 项 | 事实源 |
|---|---|
| 单例作用域 | **user × plugin id**（config/state 目录跨 named session 共享，实测 D13）。namespace 只影响 bind，不是锁的事实源 |
| 互斥手段 | `HERDR_PLUGIN_STATE_DIR/herdweb.lock` 上的非阻塞 `flock` |
| owner 元数据 | `HERDR_PLUGIN_STATE_DIR/herdweb.owner.json`：`{pid, starttime, mode: "pane"\|"service", port, config_path, started_at}` |
| 端口 | `HERDWEB_PLUGIN_PORT` 环境变量；未设则用 herdweb CLI 默认（7681）。显式给了非法值 → **fail-loud**，不静默回退。owner.json 记录实际生效值 |

**启动顺序**：`mkdir -p STATE_DIR` → 取 flock → 定端口 → **无条件覆写 owner.json**
→ spawn 服务进程（带 lock fd）→ 覆写 owner.json 为服务进程 pid → 服务运行。

**r4 更正（端口的事实源）**：r2/r3 写的「从生效配置读取端口，不硬编码 7681」**不可实现** ——
herdweb 的 `herdwebConfigOverridesBaseSchema` 是 strict object，**没有 `port` 字段**，
端口只能经 CLI `--port` 传入。把 `port` 写进 `herdweb.config.ts` 会被本体校验拒绝。
故改为 `HERDWEB_PLUGIN_PORT` 环境变量。这是设计写错了，不是实现偷懒。

**r3 改正的三处**：

1. **锁文件永不 unlink**（正确性，实测 A3）。持锁进程仍握 fd 时删掉锁文件，后来者对同路径
   `open` 会拿到**新 inode** 并再次获锁成功 → 两个 herdweb 同时在跑。
   因此：锁文件创建后永不删除，fd 持有到进程退出；
   **`STATE_DIR` 不得放在会被周期性清空的 tmpfs 上**，doctor 应能查出这种配置。
2. **owner.json 是「获锁后无条件覆写」，不是「退出时清理」**（实测 A2）。
   SIGKILL 做不到退出清理，清理只是礼貌，不是正确性条件。
   **r4 更正**：原文写的「拿到锁本身就证明前任已死」现在只对**服务进程**成立。
   锁的持有者是实际提供服务的 herdweb 进程（通过继承 fd，见 §2.8a），
   **runner 死 ≠ 锁释放** —— runner 被 SIGKILL 后，只要服务进程还活着，锁就还在。
3. **`/proc` 判据只用于报告路径**：拿不到锁时，读 owner.json 的 `pid` + `starttime`
   （Linux：`/proc/<pid>/stat` 字段 22；macOS：`kill -0` + `ps -p PID -o lstart=`）
   判断是否可信 —— 一致则报「谁在跑」，不一致则报「锁被持有但 owner 元数据不可信」，
   **不得把死 pid 说成 herdweb 还在跑**。

**两类失败必须分开报**（实测 B5 已验证走得通）：

- 拿不到锁 → `LOCK_HELD pid=… mode=… port=…`（另一个 herdweb 在跑）
- 拿到锁但 bind 失败 → `PORT_OCCUPIED port=… (got the lock; occupant is not this ledger)`

**边界情形**（实测 A3）：`STATE_DIR` 不存在要先 `mkdir -p`；目录只读时无法创建锁文件，
应 fail-loud（只读的锁**文件**本身仍可 flock，不是问题）。

### 2.8a INV-SVC：锁必须覆盖「服务行为」，不只是「账本写入」（r4 新增）

**来自实现评审 r1 的 P1。** 最初的实现让 runner 持锁、再 `spawn` 一个 herdweb 子进程去服务。
L1/L2/L3 三条不变式字面上都成立，但它们锁的是**账本写入**。
评审做了独立降层实测：runner 被 SIGKILL 后内核释放 runner 的锁，后来者立即获锁，
而**旧子进程仍在监听** —— 两个 herdweb 同时服务，owner.json 只记录第二个：

```
after runner SIGKILL: runner_alive=no child_alive=yes port1=listening
both_ports=127.0.0.1:17881 127.0.0.1:17880
```

**INV-SVC（不变式）**：runner 被 SIGKILL 后，**不允许出现「后来者起来了且旧服务进程还在监听」**。

**实现方式**：`flock` 绑定在 open file description 上，父子进程继承 fd 即共享同一个 OFD。
把 lock fd 放进子进程的 `stdio[3]`，runner 死后锁仍由实际服务的进程持有，后来者拿不到锁。
owner.json 在 spawn 成功后覆写为 **child pid**，使报告路径指向真正在服务的进程。

**两种形态各自的防线（r4 实测厘清）**：

| 形态 | runner 被杀后为什么不会双服务 |
|---|---|
| herdr pane | pty 关闭 → 子进程也随之停止 → 锁释放。真实 `plugin install` 验证走的是这条路 |
| systemd service | **无 pty，子进程会活下来** → 锁继承是唯一防线。单元测试用 stub child 模拟的正是这条路 |

两条路都验过，但分别在真实环境和单元测试里 —— 这是结论的边界，不要含糊成「都在真机验过」。

`show` / `doctor` 一律以 owner.json + 实际 listen 结果为事实源，不自行探端口猜测。

### 2.9 两个 runner 的边界契约（r3 补三处）

`HERDR_PLUGIN_*` 只在 herdr 拉起 plugin command 时注入，systemd 拉起的进程拿不到。
**决定：service 与 pane 跑同一个 runner（`serve.mjs`），差异只在环境如何提供。**

`install-service.mjs` 生成 unit 时，把解析到的路径**快照写进 `Environment=`**（实测 C7 可行）：

```ini
[Service]
Environment=HERDR_PLUGIN_CONFIG_DIR=…
Environment=HERDR_PLUGIN_STATE_DIR=…
Environment=HERDR_PLUGIN_ROOT=<plugin checkout>
WorkingDirectory=<plugin checkout>
ExecStart=<绝对 node 路径> scripts/plugin/serve.mjs
Restart=on-failure
```

**r3 补的三处**：

1. **重启必有锁空窗**（实测 C8）：`Restart=on-failure` + `RestartSec=1` 时空窗约 1.1s，
   pane 可在窗口内抢走锁。**不得把 Restart 当作互斥的延续**；
   文档要写明「service 失败重启期间，另一条 runner 可能抢到锁，随后 service 会持续 restart 失败」。
2. **卸载是四件套**（实测 C11）：`disable --now` + 删 unit + `daemon-reload` + **`reset-failed`**。
   少最后一条会留下 `not-found failed` 幽灵单元。
3. **stale 判据具体化**（实测 C10）：删掉 checkout 后启动会得到 `status=203/EXEC`。
   doctor 判定 stale 的条件是「`ExecStart` 路径不存在 **或** `ExecMainStatus == 203`」，
   **不能只看 `Active=failed`**（别的失败也会 failed）。

### 2.10 与 herdweb-setup skill 的分工

用户洞察：极客用户的实际安装过程很可能是**让自己的 coding agent 代劳**。

| 关注点 | 归属 |
|---|---|
| 分发、一行安装、市场曝光、生命周期托管 | **plugin** |
| 可执行的环境探针（输出是事实，人和 agent 都能跑） | **plugin 的 `doctor`** |
| 访谈式配置生成、部署路线选择、Tailscale/Cloudflare 引导 | **herdweb-setup skill** |

据此**不做 `expose.mjs`**：与 skill 的 `references/tailscale-serve.md` 高度重复。
`doctor` 只报告事实，末尾指一句「让你的 agent 读 `.agents/skills/herdweb-setup/SKILL.md`」。

### 2.11 升级 / 卸载契约

- 生成 unit 时同时打印卸载四件套（§2.9）
- `doctor` 检测 stale unit 并给出修复命令
- config 与 state 归 plugin 所有，reinstall 不动它们（herdr 只替换 checkout）
- 卸载 plugin 前若 service 仍在跑，`doctor` 必须报出来，否则留下占端口的孤儿进程

### 2.12 构建门槛：方案 A —— 前置检查（r3 新增）

**用户决策**：不自出 Linux 预编译（方案 B），接受本地编译。

理由：前期主力用户在 macOS，包内已有 darwin 预编译、大概率免编译；Linux 用户有能力
自己装工具链，而替他们做预编译要长期维护 x64/arm64/glibc/musl 的平台矩阵与 Node ABI 抽检，
对一个 personal tier 的 fork 收益方向反了。

**关键洞察**：真正的问题不是「需要装工具链」，而是**错误信息里看不出要装什么**。
实测 build 格 1：失败输出共 73 行，前 30 行几乎全是下载进度条，
`You need to install the latest version of Python` 在第 46 行，
而**全文从未提到 `g++`/`make`**（在找 Python 那步就退出了）。
若 herdr 截断的是头部，用户看到的像是网络慢。

**做法**：把失败提前到一个**输出极短**的步骤——manifest 的第一条 build 命令是前置检查。
herdr 的 build 命令按顺序执行、失败即中止，所以检查不过就不会进入 pnpm install，
用户看到的就是那几行明确指引，无论截断头尾都看得见。

检查内容：

- **全平台**：Node ≥ 22；**flock 能力**（`python3` 的 `import fcntl` 或 `perl` 的 `use Fcntl`
  至少有一个可用）—— runner 靠它做进程互斥，见下方 r4 更正
- **仅 Linux**（node-pty 本地编译）：`python3`、`make`、`c++`/`g++`

三者都要**真能跑起来**（执行 `--version` 并看退出码），不是只判断命令是否在 PATH，
更不是只看环境变量键是否存在。

**r4 更正（来自实现评审 r1 的 P2）**：最初只在 Linux 检查工具链，但 runner 在**所有平台**
都需要 flock 能力 —— macOS 装得上却起不来。根因是**前置检查检查的东西，与 runner 运行时
真正依赖的东西不一致**。现在 runner 走 python3 优先、**perl 兜底**（macOS 系统自带
`/usr/bin/perl`，flock 是 perl 内建），两个平台的用户都不必为互斥另装东西。
评审用两个各自独立 `open` 的进程实测过跨实现互斥：python3 持锁时 perl 竞争者确定性失败，
反向亦然 —— 这是**能力探测**，不是掩盖错误的 fallback。

失败输出形如（保持在 10 行以内）：

```
herdweb 在 Linux 上需要本地编译 node-pty（npm 包不带 Linux 预编译）。
缺少：python3, g++

Debian/Ubuntu:  sudo apt install python3 make g++
Fedora:         sudo dnf install python3 make gcc-c++
Arch:           sudo pacman -S python make gcc
Alpine:         sudo apk add python3 make g++

macOS 不需要这些（包内已有预编译）。
装好后重跑：herdr plugin install zlxlabs/herdweb
```

**不采纳的路径**（均有实测依据）：
`npm_config_build_from_source=false` 无效（格 5）；
`--ignore-scripts` 会造出「装好了但开不了终端」的 herdweb（格 s1），比装不上更糟。

## 3. 具体形态

### 3.1 目录

```
herdweb/
  herdr-plugin.toml          ← 新增
  scripts/plugin/            ← 新增
    check-prereqs.mjs          构建前置检查（第一条 build 命令）
    serve.mjs                  起服务（flock 账本 + 配置引导）
    show.mjs                   显示地址与监听状态
    doctor.mjs                 环境体检
    install-service.mjs        生成 systemd unit / launchd plist 并打印命令
    open-pane.mjs              action → pane 的转发器
  （其余一切不动）
```

### 3.2 manifest 草案

```toml
id = "zlxlabs.herdweb"
name = "herdweb"
version = "1.2.1"                     # 版本同步责任见 §5
min_herdr_version = "0.8.2"           # 唯一实测过的版本
description = "Mobile web UI for herdr — localhost only by default, you decide what to expose"
platforms = ["linux", "macos"]

[[build]]
command = ["node", "scripts/plugin/check-prereqs.mjs"]
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

（无 `[[startup]]` / `[[events]]` / `[[link_handlers]]`，理由见 §2.4。）

### 3.3 脚本职责

**check-prereqs.mjs** —— 见 §2.12。输出必须短，失败退出非零。

**serve.mjs**
1. `mkdir -p HERDR_PLUGIN_STATE_DIR`；取 `herdweb.lock` 的非阻塞 flock，
   **锁文件永不 unlink**；拿不到锁则按 §2.8 的报告路径输出 `LOCK_HELD …` 并退出
2. `HERDR_PLUGIN_CONFIG_DIR` 无 `herdweb.config.ts` 则生成默认配置（**不含 rescue target**）
3. 从生效配置解析端口，**无条件覆写** owner.json
4. `spawn node dist/cli.mjs serve --config … --port <port>`，
   并**把 lock fd 放进子进程的 `stdio[3]`**（§2.8a）；spawn 成功后把 owner.json 覆写为 child pid；
   bind 失败按 §2.8 报 `PORT_OCCUPIED …`

   **r4 更正**：原文写 `exec`。改用 `spawn` 是因为要读子进程 stderr 才能把 `EADDRINUSE`
   判成 `PORT_OCCUPIED`；`exec` 会丢掉这条判定。代价是多一个进程层，
   由 §2.8a 的 fd 继承补上锁的覆盖面。

**show.mjs** —— 以 owner.json + 实际 listen 结果为事实源，按 §2.6 的显示契约输出，
仅在真监听非回环时出二维码。

**doctor.mjs** —— 报告事实，不做决定：
- 当前模式（`pane` / `service` / `none`）、锁持有者与可信度、实际端口与监听地址
- `STATE_DIR` 是否位于 tmpfs（§2.8 的锁前提）
- service 模式：unit 是否在正式搜索目录、linger 是否开启、
  是否 stale（`ExecStart` 路径不存在 **或** `ExecMainStatus == 203`）
- 构建前置：Node 版本、python3 / make / c++ 是否真能跑
- **实际请求 `/manifest.json` `/sw.js` `/icon-192.png` `/icon-512.png` `/apple-touch-icon.png`**，
  判断返回的是 JSON/图标还是登录页重定向（把 README FAQ 那条 Cloudflare Access + PWA 的坑
  变成能跑的检查）
- 末尾指向 `herdweb-setup` skill

**install-service.mjs** —— 按 §2.9 生成 unit 到
`${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user`（复用 `scripts/install-prod.sh` 的既有做法），
macOS 生成 launchd plist；打印安装、`daemon-reload`、enable、linger 与**卸载四件套**命令，
**执行的是用户**。

**open-pane.mjs** —— 只做一件事：用 `HERDR_BIN_PATH` spawn 对应 pane。
因为 action 不是可见的错误通道（§2.5），它必须尽量不可能失败。

### 3.4 配置与状态位置

- `HERDR_PLUGIN_CONFIG_DIR/herdweb.config.ts` —— 主配置
- `HERDR_PLUGIN_CONFIG_DIR/herdweb.config.local.ts` —— **密钥**（voice / push）。
  herdweb 没有 dotenv 加载路径，不能用 `.env.local`
- `HERDR_PLUGIN_STATE_DIR/herdweb.lock`、`herdweb.owner.json` —— 运行时账本（§2.8）
- `HERDR_PLUGIN_ROOT` 什么都不放

### 3.5 用户旅程

```bash
herdr plugin install zlxlabs/herdweb              # 前置检查 → clone → build，安装前 preview 可审
herdr plugin action invoke zlxlabs.herdweb.start  # 开 tab 跑起来
# 同机：浏览器开 http://127.0.0.1:7681
# 看状态/地址：herdr plugin pane open --plugin zlxlabs.herdweb --entrypoint show
# 要常驻：开 install-service popup → 照给的命令自己跑
# 要从手机连：让 agent 读 .agents/skills/herdweb-setup/SKILL.md
```

### 3.6 安全模型补充（写进 README）

- plugin 默认只监听 `127.0.0.1`，且**不提供任何一键对外暴露的入口**
- 能访问 herdweb 的人 ≈ 拥有你的用户权限
- rescue target 默认关闭；启用它等于在无认证 endpoint 上开一个独立于 herdr 的 shell

## 4. 仍未测、写码时要补的

已由两份矩阵覆盖的不再列。**真未测成的**：

1. **macOS 全链**：darwin 预编译在 Node 22 下 `require()` 是否真的能加载；
   launchd plist 的安装/卸载/KeepAlive 等价物；`ps -p PID -o lstart=` 作为 starttime 判据
2. **linger**：需独立测试用户（在本机验证会拆掉 user systemd 连带 default herdr 与 7681 上的
   herdweb）。步骤：建用户 U → `enable-linger U` → 以 U 装 unit → `terminate-user U` →
   `systemctl --user -M U@ is-active`；再对照 linger=no
3. **零 workspace 的 action 上下文**：herdr 0.8.2 新建 server 必带 `w1`，造不出该场景
4. **TUI toast**：action 失败时 TUI 里是否有可见提示（探针 session 无客户端附着，未测成）
5. **linux arm64 / musl 补齐工具链后**能否链接成功；**Windows** 全链（包内有 win32 预编译，未跑）
6. **PWA 五路径**在有认证代理与无代理两种情形下 doctor 的判定正确性
7. **marketplace 收录**：manifest 已于 2026-09-01 进入默认分支，topic 也已就位，
   两个收录条件均满足；索引 30 分钟刷新一次，尚未确认列表里真的出现

**已完成（r4，移出待办）**：真实 `herdr plugin install zlxlabs/herdweb --yes` 端到端 ——
42 秒完成 clone + 前置检查 + build + 注册；preview 正确列出 3 条 build 命令与入口；
pane 在 17801 起服务、HTTP 200；owner.json 记录的是实际监听进程；`uninstall` 后 checkout
清除、config/state 按契约保留；本机既有 herdweb（7681）全程未受影响。
注意该次安装复用了本机 pnpm store 缓存，**不代表干净机器的构建耗时**
（那个由 `probes/build-matrix.md` 覆盖）。

## 5. 落地拆卡

- ~~**卡零**：打 GitHub topic `herdr-plugin`~~ —— **已完成**（2026-08-31）
- ~~**卡一（M）**：`herdr-plugin.toml` + `check-prereqs.mjs` + `serve.mjs` + `open-pane.mjs`~~
  —— **已完成**（PR #155，含一轮修复；测试锁定 L1/L2/L3 + INV-SVC）
- **卡二（M）**：`show.mjs` + `doctor.mjs` + `install-service.mjs`，含 §2.9 三条改正
- ~~**卡三（S）**：README plugin 一节 + 平台差异说明~~ —— **已完成**（PR #154）。
  **待跟进**：README 的 macOS 说明需补一句「plugin 用系统自带的 perl 或 python3 做进程互斥」
- **卡四（S）**：manifest `version` 与 `package.json` 版本一致性的 CI 检查
  （semantic-release 只改后者，marketplace 读前者）

卡一与卡二有产出依赖（卡二的 doctor 要读卡一定义的 owner.json 格式），**串行**。
卡三、卡四与前两张无依赖，可并行。

## 6. 评审与实测的处置对照

| finding | 来源 | 判定 | 处置 |
|---|---|---|---|
| `.env.local` 不被读取 | r1 | P1 | §3.4 改为 `herdweb.config.local.ts` |
| 探端口不是单例互斥 | r1 | P1 | §2.8 资源账本 |
| `serve-lan` 无认证暴露 | r1 | P1 | 已砍（§2.6，用户决策） |
| service 拿不到 `HERDR_PLUGIN_*` | r1（标 P2） | 提 P1 | §2.9 边界契约，实测 C7 验证可行 |
| **锁文件 unlink → 双持有** | runtime A3 | **P1** | §2.8 改正 1：锁文件永不 unlink + STATE_DIR 不放 tmpfs |
| Restart 锁空窗 1.1s | runtime C8 | P2 | §2.9 补 1：写明空窗，不拿 Restart 当互斥延续 |
| action 恒 EXIT 0 不回显 | runtime D14 | P2 | §2.5 定死 action 只当触发器 |
| 卸载缺 `reset-failed` | runtime C11 | P3 | §2.9 补 2：四件套 |
| stale 判据不足 | runtime C10 | P3 | §2.9 补 3：路径不存在或 203/EXEC |
| 作用域应为 user × plugin id | runtime D13 | P3 | §2.8 表格改正 |
| 陈旧 owner.json | 先前担心 | **降级** | 非正确性缺口，获锁即可覆写（§2.8 改正 2） |
| Linux 无预编译、干净机必挂 | build 1/4/p1 | 产品决策 | §2.12 方案 A：前置检查 |
| `--ignore-scripts` 装完 PTY 不可用 | build s1 | 不采纳 | §2.12 明列为不采纳路径 |
| systemd unit 路径错 | r1 | P2 | §3.3 复用 `install-prod.sh` 做法 |
| `prefix+w` 冲突 | r1 | P2 | §2.5 keybinding 降为 opt-in 示例 |
| rescue 必要性被夸大 | r1 | P2 | §2.7 降为 opt-in |
| 升级/卸载契约缺失 | r1 | P2 | §2.11 |
| IPMI 类比过强 | r1 | P3 | §2.3 改为故障域矩阵 |
| pnpm 版本不锁 | r1 | P3 | backlog：构建契约写明版本策略 |
| manifest 版本不同步 | r1 | P3 | §5 卡四：CI 检查 |
| `allowBuilds` 是 pnpm 11 字段但用 pnpm@10 | build | P3 | backlog |

## 7. Backlog（评审登记、判定接受不修）

来自实现评审 r2，均已按本仓 P1 两问重判为 P2/P3，不阻塞合入：

| 条目 | 级别 | 为什么接受不修 |
|---|---|---|
| `P2-NEW-OWNER`：owner.json 的 runner→child 两阶段发布有崩溃中间态 | P2 | 窗口是 spawn 到第二次 `writeOwner` 之间的毫秒级；互斥不破、不会双开；后来者会得到 `LOCK_HELD (owner metadata untrusted)` 而非把死 pid 报成活服务。修它需要引入 child-ready 握手 = **新增机制**，违反「禁止为修复 P2 新增状态/机制」 |
| `P3-TEST-CLEANUP`：测试清理失败被静默吞掉（`ss` 缺失或杀进程失败时不 fail-loud） | P3 | 当前 Linux 实测 `ss` 存在，且 `allocPort()` 会跳过仍占用的端口，无证据表明会误绿。下次动这些测试时顺手改成清理失败 fail-loud |
| `pnpm-workspace.yaml` 的 `allowBuilds` 是 pnpm 11 字段，本链用 pnpm@10 未生效 | P3 | 存量问题，与本批改动无关 |
| `npx --yes pnpm@10` 不锁 pnpm 补丁版本 | P3 | 构建契约里写明版本策略即可，暂不加 CI 检查 |
| manifest `version` 与 `package.json` 版本需保持一致 | P3 | 见 §5 卡四；semantic-release 只改后者，marketplace 读前者 |

## 8. 这一批的经验（留给下一批）

1. **不变式要定在「行为」层，不是「写入」层。** §2.8 最初三条不变式（L1/L2/L3）全部成立，
   测试也真的锁死了，但它们保护的是账本写入。真正要保证的「同一时刻只有一个 herdweb 在服务」
   直到评审的降层第三问（保护覆盖的是写入还是行为）才被逼出来。**拆卡时就该问这一问。**
2. **实测推翻纸面推演的比例很高。** 本批被实测推翻的初稿假设至少 8 条
   （linux 无预编译、`.env.local` 不被读、`herdr --session` 只在 TUI 入口自动拉 server、
   systemd unit 搜索路径、popup 的 CLI help 与实际能力不符、`prefix+w` 冲突、
   端口不在 config schema、action invoke 恒 EXIT 0）。**infra 类设计先派实测卡再拆实现卡。**
3. **「验证走的哪条路」要写清楚。** pane 形态靠 pty 兜底、systemd 形态靠锁继承兜底，
   真实安装验证只走到了前者。把这个边界写下来，比笼统说「已在真机验证」诚实。
