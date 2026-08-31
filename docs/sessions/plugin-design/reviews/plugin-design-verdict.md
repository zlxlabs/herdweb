# herdweb plugin 方案独立评审

## 结论

**Verdict：暂不通过，不建议按当前方案直接开工。**

方向本身值得做：把 herdweb 作为可安装的 launcher，并把“脱离 herdr 生命周期的常驻服务”作为可选部署形态，能解决当前没有分发路径的问题。但当前方案把三个不同层次的问题混在一起：插件入口可用性、服务生命周期、网络安全边界。按现在的形态落地，最危险的不是安装失败，而是可能把一个无认证的终端控制面暴露到局域网，或在 pane / systemd / 手工启动之间误判实例所有权。应先收紧安全入口、定义单例资源账本，并修正配置秘密文件路径，再进入写码。

本审查按仓库声明的 `risk-tier: personal` 评估；由于本方案的核心是服务失败路径和端口/生命周期资源账本，P1 判定按 internal 档提档。审查对象固定为任务卡指定的草案，未审现有 herdweb 代码的存量风格问题。

## 本轮新证据与事实核对

本轮取得了不同于草案原文的新证据：本机 herdr CLI 的真实输出、临时插件的 link/open 行为、Node 22 的干净归档构建、配置加载失败探针、缺失命名 session 的启动探针，以及 `systemd --user` 的 unit 搜索路径。

- `herdr --version` 输出 `herdr 0.8.2`。
- `herdr plugin pane open --help` 的 placement 文案只有 `overlay, split, tab, zoomed`，但这不能推出 manifest 的 popup 不可用。临时插件 manifest 声明 `placement = "popup"` 后，`herdr plugin link` 成功，随后在临时 server 上执行 `herdr --session ... plugin pane open --plugin examples.popup-probe --entrypoint preview` 和显式 `--placement popup` 都返回 `{"type":"ok"}`；带 `width = "60%"`、`height = 24` 的 manifest 也被 0.8.2 接受。因此草案的“待实测”已被部分解决：0.8.2 的 manifest popup 可用，但仍不能把 `0.8.0` 作为最低版本，除非另行实测 0.8.0。
- Node 22.23.1 临时归档副本中，`npx --yes pnpm@10 install --frozen-lockfile` 成功解析 v9 lockfile；安装日志明确出现 `node-pty` 的 `node-gyp rebuild`、`gyp info find Python`、`make` 和 C++ 编译。之后 `npx --yes pnpm@10 run build:dist` 成功。用只含 Node 22、系统基本路径且没有全局 pnpm 的 PATH 重跑 build，也成功，说明“免预装 pnpm”成立，但不等于“只有 Node 22 就能安装”。
- `herdweb init` 在临时目录生成的是 `export default { ... }` 的 `herdweb.config.ts`，不需要导入 `defineConfig`。用 Node 22 直接执行 dist CLI 加载该文件时，加入未知字段会得到 `Config validation failed`；这证明 `--config` 指向 `.ts` 文件和裸 default export 都能工作。
- 在临时配置中启用 ASR、同时放置 `.env.local` 后，Node 22 CLI 仍报 `config.asr.doubao.apiKey: expected non-empty string, received redacted`。仓库中配置加载只动态导入主配置及同目录的 `herdweb.config.local.ts/.js`，没有 dotenv 依赖或 `.env.local` 读取路径。
- `herdr --session __herdweb_plugin_review_missing_20260831__` 在不存在 server 时启动成功；随后 `status server` 输出 `status: running`、`version: 0.8.2`，停止后才恢复 `status: not running`。这与草案把“server 不存在”当作需要裸 bash 才能闭环的前提不同。
- `herdr --default-config` 输出 `# workspace_picker = "prefix+w"`。草案 manifest 没有任何 keybinding 声明；官方插件文档把 `[[keys.command]] type = "plugin_action"` 放在 herdr 用户的 config.toml 中，而不是插件 manifest 中。

参考契约：[herdr 插件文档](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx)、[herdr CLI reference](https://herdr.dev/docs/cli-reference/)、[herdr marketplace](https://herdr.dev/docs/marketplace/)。插件文档明确说明 build 失败时不注册插件、不会替用户安装缺失工具链；也明确说明 runtime command 的工作目录是插件目录、`HERDR_PLUGIN_*` 变量由 herdr 注入，且 plugin registry 对当前用户的各 session 全局可见。

## 设计不变式

后面的 finding 以这些草案自己承诺的不变式为锚点：

1. “任何时候只有一个 herdweb 实例”，且用户能知道它是 pane 还是 service（草案 3.3）。
2. 默认保持 localhost；任何网络暴露都必须符合现有安全模型（草案 2.6、README Security model）。
3. plugin install 后入口真实可运行，失败要可解释（草案 2.1、3.5）。
4. plugin 配置和秘密放在指定位置，并被 herdweb 实际消费（草案 3.4）。
5. systemd / launchd 形态不依赖 herdr server 的生命周期（草案 2.3）。

## Findings

### P1-1：探测 7681 不是单例互斥，且“模式识别”没有可信事实源

**违反不变式：** 1。

**问题是什么：** `serve.mjs` 先连接 7681 再决定“已有 service / 已有 pane / 没有实例”，这是观察，不是锁。两个启动者都可能在检查和真正 bind 之间看到端口空闲；反过来，TCP 端口被占用也不能证明占用者是 herdweb，更不能从端口推出所在 Herdr tab。

**什么条件下触发：**

- 无关进程先占用 7681；探针会把它误称为已有 herdweb，并打印错误的“用 show 看地址”。
- systemd 正在重启，旧监听已释放而新进程尚未 bind；pane 可以抢到 7681，随后 systemd 失败，或两者交替失败。
- 用户手工用 `herdweb serve --port 8080` 启动，plugin 仍只检查 7681，于是两个 herdweb 可以同时运行。
- 两个不同 named session 的 herdr server 都能看到同一全局 plugin，并分别触发 start action；这是现实入口，不是假设的并发线程。
- 不同 user 或 network namespace 各自看到不同的端口空间；“全机器单例”在容器、多用户环境中没有定义。

**后果：** 同一 host 上可能出现两个控制面，分别连接同一个或不同的 herdr target；输入、重启感知和通知可能重复或互相误导。仓库现有 `src/serve.ts:560` 还按端口分隔通知状态目录，所以换端口并不会被现有状态账本识别为同一 herdweb。无关进程占用时则会静默阻断正常启动，并给出错误归因。两种结果都直接破坏“一个实例且用户知道模式”的核心承诺。

**建议方向：** 先定义单例范围（至少是同一 user + 同一 network namespace，还是更宽的 host 范围），再用实际 listen 结果作为端口事实源，并用跨 pane/service 共享的操作系统锁或等价原子租约串行化启动。所有入口必须共享同一端口来源和 owner 元数据；对“端口被其他进程占用”必须明确报冲突，不能冒充 herdweb。若允许用户自定义端口，就必须把端口纳入同一个资源账本，而不是只探测 7681。

### P1-2：方案指定的 `.env.local` 不会被 herdweb 读取

**违反不变式：** 4。

**问题是什么：** 草案把 `HERDR_PLUGIN_CONFIG_DIR/.env.local` 定义为 voice / push 密钥位置，但 herdweb 实际没有 dotenv 加载。`cli.ts:215-251` 只查主配置旁的 `herdweb.config.local.ts/.js` 及 legacy sibling，然后动态导入；`package.json` 也没有 dotenv 依赖。

**什么条件下触发：** 用户按草案把 ASR key、push token 或其他秘密写入 `.env.local`，再由 `serve.mjs` 用 `--config .../herdweb.config.ts` 启动。

**后果：** `asr.enabled = true` 时 API key 仍为空，服务在配置校验阶段失败；未触发校验的字段（例如通知 token）会被忽略，形成“配置成功但安全/功能语义未生效”的静默错误。用户会以为秘密已被保护并加载，实际服务使用的是默认值或直接起不来。

**核实方式：**

```text
rg -n '\.env|dotenv|process\.env' cli.ts src package.json
```

结果只有 XDG 配置目录、状态目录等环境变量，没有 `.env.local` 或 dotenv 加载。另在临时目录创建 init 配置、启用 ASR、放置 `.env.local` 后运行 Node 22 dist CLI，实际输出为：

```text
config.asr.doubao.apiKey: expected non-empty string, received redacted
```

**建议方向：** 在不改 herdweb 本体的前提下，应把 plugin 文档和生成器改为使用实际支持的 `herdweb.config.local.ts` 或 `.js` sibling，并明确其 default export 形状；或者先接受“零改动”被打破，再设计有测试和权限约束的显式 env loader。不能继续把 `.env.local` 写进设计契约。

### P1-3：`serve-lan` 与无认证终端控制面的安全模型不自洽

**违反不变式：** 2。

**问题是什么：** `serve-lan` 用 `--host 0.0.0.0` 直接监听，herdweb 本身没有 login、password 或 ACL。草案给出的四个缓和理由——显式触发、临时、pane 可见、随时可关——都不是访问控制，也不保证服务真的短命。

**什么条件下触发：** 用户在共享 WiFi、办公网、被路由到的 VLAN、开启网桥的容器或存在访客设备的家庭网络中打开 `serve-lan`。Herdr pane 可在 detach 后继续存在，因而“临时”只表示依赖 pane 进程，不表示有时间上限；顶部风险文字也不能阻止任何能访问端口的设备发起请求。

**后果：** 同一可路由网络内的任意设备都可能驱动用户权限下的 herdr server。再叠加默认 rescue target，herdweb 甚至可能在 herdr 不可用时提供一个直接的用户 shell。该后果属于 internal 档的越权访问，不是单纯 UX 不佳。

**核实方式：** 仓库 README 的安全契约明确写着“任何能到达 herdweb 的人都能以用户权限驱动 Herdr”，并明确说 `0.0.0.0` 会暴露给 LAN / 能路由到该端口的对象，要求有独立网络控制；见 `README.md:149-160`。源码的监听调用是 `src/serve.ts:1014-1022`，非回环 host 只打印 warning，不增加认证。

**建议方向：** 默认 plugin 只提供 localhost service；同网入口应改成需要用户再次明确确认、并要求用户确认网络信任边界的操作，或者只打印可信代理/VPN 的命令而不直接 bind `0.0.0.0`。无论保留与否，都不能把“看得见和关得掉”当作安全边界；验收必须包含共享网络、detach 后仍存活、HTTP 与 WebSocket 的未认证访问。

## P2 Findings

### P2-1：systemd unit 写到 plugin config dir，但示例命令不会加载它

**违反不变式：** 3、5。

**问题是什么：** 草案说 `install-service.mjs` 把 systemd user unit 生成到 config dir，随后让用户执行 `systemctl --user enable --now herdweb`。普通 systemd user manager 的搜索路径不包含 `HERDR_PLUGIN_CONFIG_DIR`，所以该命令找不到 unit，除非另有未写出的复制或链接步骤。macOS 的 launchd 也需要明确的 bootstrap/load 路径，草案没有同等契约。

**什么条件下触发：** 用户按草案原样生成 unit 并执行显示出来的命令。

**后果：** service 主路 visibly fail，用户以为已安装却没有常驻服务；这也使后续 `show`、doctor 的“service 模式”判断失去基础。

**核实方式：** 本机执行 `systemctl --user show --property=UnitPath --value`，输出的路径包含 `/home/zlx/.config/systemd/user`、`/run/user/1000/systemd/user` 等，不包含 herd plugin config dir。仓库现有 `docs/deploy-herdr.md:54-84` 和 `scripts/install-prod.sh` 的真实契约是把 unit 安装到 `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user`，然后 `daemon-reload`，而不是留在应用配置目录。

**建议方向：** 选择一个明确的用户动作：要么生成到 systemd/launchd 的正式目录并只打印 enable 命令，要么留在 config dir 但同时打印可审计的安装、reload、enable 命令。unit 必须有 `[Install]`、Restart、WorkingDirectory、稳定的 Node PATH 和卸载/升级清理契约；不能把这些留作脚本实现时再猜。

### P2-2：service 不是 herdr runtime command，无法天然获得 plugin 环境

**违反不变式：** 3、4、5。

**问题是什么：** `HERDR_PLUGIN_ROOT`、`HERDR_PLUGIN_CONFIG_DIR`、`HERDR_PLUGIN_STATE_DIR` 等变量是 herdr 启动 plugin command 时注入的；systemd 直接启动的进程不会自动获得它们。若 unit 的 `ExecStart` 是 `node scripts/plugin/serve.mjs`，脚本看不到 config dir；若改为直接执行 `node dist/cli.mjs serve --config ...`，它又绕过了 `serve.mjs` 的配置生成、互斥和状态识别路径。

**什么条件下触发：** service unit 从用户 manager 启动，且设计没有明确地把所有必要路径、Node 可执行文件和共享锁上下文写入 unit。

**后果：** systemd 与 pane 可能运行不同配置、不同版本的 runner，或一条路径有互斥而另一条没有；重启后表现与手工启动不一致，且 service failure 可能只留在 systemd 日志。

**建议方向：** 把“被 Herdr 调用的 pane runner”和“被 systemd/launchd 调用的 service runner”之间的边界写成明确契约：路径必须显式、配置必须显式、两者必须共用同一资源所有权机制。若为了复用选择让 service 运行 plugin 脚本，就必须显式提供它需要的环境；若直接运行 dist CLI，就要说明哪些初始化和锁逻辑不再由它承担，并补上同等机制。

### P2-3：Node 22 不是 build 的完整前置条件，失败体验没有被设计闭合

**违反不变式：** 3。

**问题是什么：** `npx --yes pnpm@10` 确实解决了“用户没装 pnpm”，但 package 依赖 `node-pty`。在干净归档副本中该依赖没有可用 prebuild，安装进入 `node-gyp rebuild`，实际需要 Python、make、C/C++ 编译器和 Node headers。方案只记录“build 链不依赖 mise / typos”，容易让读者误解为只要 Node 22 就够。

**什么条件下触发：** 新机器只有 Node 22，缺少 Python 或编译工具，或者无法下载 npm 包/Node headers。

**后果：** herdr 按契约中止 install、不注册 plugin、不安装工具链；用户看到的是带截断 stdout/stderr 的 build failure，而不是可直接行动的缺失依赖清单。对“降低使用门槛”的目标是可接受性问题，但因为错误会 fail-loud，不升级为 P1。

**核实方式：** Node 22.23.1 下执行方案的两条命令得到：`node-pty ... node-gyp rebuild`、`gyp info find Python ... /usr/bin/python3`、`make`、`CXX(target)`，最终 build 才成功。官方文档也明确说 build failure 不替用户安装缺失 toolchain。

**建议方向：** 在 install 前提供不依赖插件已注册状态的前置检查，明确列出 Linux/macOS 的系统构建要求和网络要求；或者重新评估是否能提供包含可用 native artifact 的分发方式。无论选哪条，都应在 clean Node 22、缺 Python、缺 compiler、离线四种环境分别验收。

### P2-4：`prefix+w` 的用户旅程不存在，且与 Herdr 默认动作冲突

**违反不变式：** 3。

**问题是什么：** 草案把 `prefix+w → action show → popup` 写成默认链路，但 manifest 没有 keybinding 声明。Herdr 的 plugin manifest 只声明 action；用户 keybinding 在 herdr 的 `config.toml` 中另行配置。更直接的是，本机默认 `prefix+w` 是 `workspace_picker`。

**什么条件下触发：** 用户只执行草案的安装和 `start` action，没有手工修改 herdr config；或用户照文案把 `prefix+w` 绑定到 show。

**后果：** 安装后按 `prefix+w` 只打开 workspace picker；若手工覆写，则破坏 Herdr 原有导航动作。二维码/诊断入口的核心旅程因此不是安装即用。

**核实方式：** `herdr --default-config | rg -n -A2 -B2 'workspace_picker|keys.command'` 输出 `# workspace_picker = "prefix+w"`；官方插件文档的 keybinding 示例另列 `[[keys.command]] type = "plugin_action"`，不在 plugin manifest 的条目类型中。

**建议方向：** 把快捷键设为用户 opt-in 的单独示例，使用不覆盖默认导航的组合；同时保留 action list / CLI invoke 作为无快捷键路径。`open-pane.mjs` 作为两个 action 共用的环境适配器可以保留，但应明确它使用 `HERDR_BIN_PATH` 调 Herdr CLI、失败如何显示；真正缺失的是 keybinding 安装契约，不是再加更多 pane 类型。

### P2-5：rescue target 的必要性被实测行为夸大，并扩大默认入口

**违反不变式：** 2、3。

**问题是什么：** 草案把“herdr server 不存在”作为默认 `bash -l` rescue target 的主要理由，但 0.8.2 对不存在的 named session 会自动启动 server。裸 bash 仍可作为“herdr 二进制缺失、server 启动失败或需要修复配置”的最后一跳，却不是 server 不存在时的必需闭环。

**什么条件下触发：** plugin 默认生成两个 explicit targets，用户首次打开页面或远程访问时选择 target；或者用户把 rescue 当成 server 死亡的普遍解决方案。

**后果：** 默认配置从 single 变成 explicit，手机必然多出 target picker；同时一个无认证的 herdweb endpoint 多了独立于 herdr 的用户 shell。草案“herdr pane 本来就能跑任意命令，所以不增加攻击面”的说法不完全成立：rescue 改变了命令可用的生命周期边界，尤其是在 herdr server 正好不可用时。

**核实方式：** `herdr --session __herdweb_plugin_review_missing_20260831__` 后查询同名 server，实测输出 `status: running`、`version: 0.8.2`；仓库 `src/config.ts:378-387` 的默认配置则只有一个 implicit default target，`src/config-schema.ts:588-607` 规定显式 target 必须有 `defaultTargetId`，且两个 target 会进入 explicit 模式。

**建议方向：** 将 rescue 降为明确的 opt-in / 最后手段入口，或者只在 doctor 判定 Herdr 启动失败时指导用户临时使用；若保留默认入口，必须把 target picker、权限等价性和“server 死后仍可直接执行用户命令”写进安全模型与验收，而不能称作零攻击面。

### P2-6：所谓“带外管理口”是过强类比，掩盖了共享故障域

**违反不变式：** 5。

**问题是什么：** systemd service 确实能脱离某个 herdr pane 的生命周期，但它仍运行在同一台机器、同一用户、同一 Node/文件系统/网络故障域；默认 target 还要启动 `herdr --session default`。这更准确地是外部 sidecar / companion service，不是 IPMI 意义上能在 OS 不可用时管理 OS 的独立管理口。

**什么条件下触发：** Node、plugin checkout、用户 manager、端口、用户权限或 herdr binary 出问题；或者 pane 与 service 共享同一个 herdweb 端口和 target。

**后果：** “systemd 必须与 pane 并存且能救援”会让实现优先堆叠形态，却没有定义哪些故障它真的能跨越、哪些故障只能人工修复。用户可能在 herdr/Node 已损坏时继续期待手机端救援，得到的是同一故障域中的错误页面。

**建议方向：** 保留外部生命周期形态，但改用故障域和能力矩阵描述：它能跨过 pane/tab/server 的退出，不能跨过 host、user manager、Node、checkout、网络或权限故障。只有在该矩阵证明有独立收益时，才把 service 作为主路；pane 仍可作为本地透明前端，而不是与 IPMI 完全等价的一等救援通道。

### P2-7：端口、状态目录和 service 生命周期没有统一的升级/卸载契约

**违反不变式：** 1、3、4、5。

**问题是什么：** 草案只描述了生成 unit 和读取当前模式，没有规定 plugin uninstall、reinstall、Herdr 升级、端口变更时如何停止旧 service、撤销旧 unit、迁移配置和清理状态。官方契约说明 GitHub reinstall 会替换 managed checkout，而 config/state 由 plugin 自己拥有。

**什么条件下触发：** 用户卸载 plugin、重新安装新 commit、Herdr 更新 manifest，或把 service 从某次 plugin root 路径切换到新 checkout。

**后果：** systemd 可能保留指向已删除 checkout 的 enabled unit；旧进程仍占端口；新 pane 误判为冲突；config/state 与新 plugin 版本不匹配。问题多半是可见的 systemd failure，但会让“service 主路”失去可恢复性。

**建议方向：** 把安装、启用、停用、卸载、升级拆成可验证的状态迁移，明确谁拥有 unit、端口锁、config 和 state；卸载前必须给出 stop/disable/删除 unit 的路径，重装后必须验证 unit 指向稳定 runner 而非一次性 checkout 路径。

## P3 Findings

### P3-1：`npx pnpm@10` 没有锁定 pnpm 本身，构建可重复性不足

**违反不变式：** 3。

**问题是什么：** `pnpm-lock.yaml` 锁定依赖树，不锁定 `npx --yes pnpm@10` 实际下载的 10.x 版本。今天的探针使用的是 pnpm 10.34.5；未来同一 manifest 可能运行另一版 pnpm。

**什么条件下触发：** pnpm 10 发布行为变化、registry 变化或用户在受限网络下只拿到不同缓存版本。

**后果：** 安装可能出现可见的 lockfile/build 差异；不构成当前 P1，但会增加 marketplace 用户复现失败的概率。

**建议方向：** 在不依赖用户预装 pnpm 的前提下，仍给 bootstrap 工具一个明确版本策略，或者把允许的 pnpm 版本和失败提示写入构建契约，并在 release/CI 检查。

### P3-2：manifest version 与 package version 的同步责任没有写进设计

**违反不变式：** 3。

**问题是什么：** 草案 manifest 固定为 `version = "1.2.1"`，而 package 使用 semantic-release 管理版本。后续 herdweb release 若只更新 package version，marketplace 看到的 plugin metadata 会陈旧。

**什么条件下触发：** 任意一次不同时修改 manifest 的 herdweb feature/fix release，或 marketplace 按 manifest version 展示更新时。

**后果：** 用户看到的 marketplace 版本、实际 checkout 内容和支持信息不一致；不会直接损坏数据，但会削弱更新判断和信任。

**建议方向：** 明确单一版本源和 CI 一致性检查；若暂时接受人工同步，应把它列为发布前的硬验收，而不是只在当前草案中写一个版本字符串。

## 逐项回答七条重点

1. **定位：** “脱离 pane 生命周期的 companion service”成立；“IPMI 带外管理口”不成立为完整类比。它能跨 pane/server 退出，不能跨同机 Node、user manager、checkout、网络和权限故障。
2. **单例：** 端口探测不能守住。必须定义作用域，采用真实 bind + 跨入口原子锁/owner 账本，并覆盖端口变更、无关占用、重启窗口、多 session、多 user/namespace。
3. **入口：** “keybinding 绑 action、不能直接绑 manifest pane”在 0.8.2/官方文档语义下成立；action 输出不会进入当前 pane，而由 plugin command log 记录。`open-pane.mjs` 可以作为使用 `HERDR_BIN_PATH` 的转发器，但草案缺少用户 keybinding 配置，且 `prefix+w` 已被 workspace picker 占用。
4. **build：** `npx --yes pnpm@10` 在 Node 22.23.1 上可用，lockfile 也能吃下；真正的门槛是 node-pty native build。Herdr 失败时不注册 plugin，错误可见但对降门槛目标不够友好。
5. **安全：** 拒绝静默 daemon 的原则与 localhost service 一致；无认证的 `serve-lan` 不因“显式、可见、可关”而安全，rescue shell 也不是零攻击面。两者都需要收窄入口和重新写清网络/权限边界。
6. **本体依赖：** 零改动在配置解析层是可行的：`--config` → cwd → XDG herdweb 目录的实际顺序成立，裸 default export 合法，explicit targets 的 `defaultTargetId` 与 trailing command 约束成立。真正落空的是草案声明的 `.env.local` 路径，以及把 `herdweb init` 说成会生成带 rescue target 的默认配置；实际 init 模板没有 targets。
7. **遗漏实测：** 见下一节；重点是完整 manifest 在 0.8.2/目标最低版本的行为、动作上下文、service unit 的真实启动环境、互斥矩阵和安全暴露持久性。

## 写码前必须补的实测

以下不是“实现后再看看”的项目，而是可能推翻当前设计的入口级证据：

1. 用一个完整临时 manifest 在 herdr 0.8.2 及声明的最低版本分别执行 link、action invoke、pane open；覆盖 popup、尺寸、tab、多个 build、platforms、disabled plugin 和没有活动 workspace 的 action。0.8.2 已确认 manifest popup 可用，但 `--help` 文案与 manifest 能力不一致，不能只以 help 作版本判据。
2. 从两个不同 named session、一个普通终端、一个无活动 client 的上下文触发同一 action，断言 `HERDR_BIN_PATH`、socket、workspace/tab/pane context 的实际值和 popup 是否开在触发它的 session；同时确认 action stdout/stderr 如何进入 log、失败是否回显给用户。
3. 在只有 Node 22 的环境分别模拟有/无 Python、make/C++ 编译器、Node headers、npm registry 和网络代理，记录 `plugin install` 的最终输出、残留 checkout、registry 是否注册；不能把“失败不注册”只当文档事实。
4. 生成真实 systemd user unit 和 macOS launchd plist，验证 unit 是否在正式搜索目录、`daemon-reload`/bootstrap 后能启动、退出后 Restart 行为、无交互 PATH、`HERDR_PLUGIN_*` 路径、linger、卸载和 reinstall 后的清理。
5. 做端口组合矩阵：无关进程占用、两次并发启动、service 重启空窗、手工 `--port`、不同 named session、不同 user、不同 network namespace/container；每个结果都要同时记录监听 owner、实际 URL、service 状态和 show/doctor 的归因，不能只记录“端口开了”。
6. 对 config dir 做 `.ts`、`.js`、`.local.ts`、`.local.js`、`.env.local`、已有坏配置和已有配置后再次启动的矩阵；断言最终生效的 target、secret 和 source label。特别验证 plugin 生成器不会在已有 `.js` 时只检查 `.ts` 就覆盖/旁路配置。
7. 在共享 WiFi 与 detach 后分别访问 LAN 入口，验证无认证 HTTP、WebSocket、PWA 静态资源、Origin/Host 处理和进程存活；若 rescue 保留，再单独验证 herdr server 退出后 shell target 是否仍能执行命令。
8. 在公开默认分支加 topic 后，用 marketplace 的实际刷新链路确认 manifest 被收录、显示的版本/路径/commit 正确；当前 `gh repo view zlxlabs/herdweb` 显示 public、非 archived、非 fork，但当前 topics 为空，不能把“自动索引”当成已经占位。

## 我认为方案里最可能错的一件事

方案把 `HERDR_PLUGIN_CONFIG_DIR/.env.local` 当成 herdweb 会读取的秘密配置文件；实际 resolver 只加载 `herdweb.config.local.ts/.js` sibling，`.env.local` 会被忽略，ASR 会报缺 key，其他配置则可能静默使用默认值。这是最确定、最直接、已有 Node 22 实测复现的错误。

## 方案漏掉但我认为该做的

- 先写出“实例作用域 + 端口 + lock owner + service unit + state/config”的资源账本，再决定 pane/service 是否共用一个 runner。
- 把 LAN 暴露从“便利入口”改成带网络信任确认的显式安全流程，或只提供可信代理/VPN 命令。
- 把正确的 `herdweb.config.local.ts/.js` 秘密路径、systemd/launchd 安装位置、卸载/重装清理和 Node native build 前置条件写进用户旅程。
- 给 manifest 兼容性、版本同步和 keybinding opt-in 加可机械验证的 CI/发布门槛。
