# 多设备 / 多 Server 控制台：可行性调研与方案草案

- 日期：2026-08-23
- 状态：**讨论稿（未立项）**——本文是调研结论 + 推荐路线，尚未进 GOALS.md 里程碑
- 背景：herdweb 目前是「一个 serve 进程暴露一个 herdr session」。herdr 支持本机多 server（命名 session），且一个人往往有多台装了 herdr 的设备。本文评估把 herdweb 升级为「多设备、多 server、可自由切换」的控制台的可行性与路线。

## TL;DR

1. **可行，且比最初评估便宜得多。** 关键转折是 herdr 自带的 SSH 瘦客户端模式 `herdr --remote <host>`：它把「跨设备」这一维完全委托给 herdr + SSH，herdweb 不需要自建任何分布式层。
2. 最终形态 = **方案 A（一个 herdweb 进程管本机多 session）+ target 列表参数化**（每个 target 的 command 是 `herdr --session x` 或 `herdr --remote host`）。
3. 自建 hub（HAPI 式）对「终端控制」不再必要；HAPI 调研留下的是设计参考（重连参数表、状态通道与 PTY 通道分离），不是要抄的架构。
4. **今天零代码就能验证**：`herdweb serve --port 7682 -- herdr --remote <host>` 再起一个实例，就是第二台设备的手机界面（代价是已知的 per-port 痛点：N 个 PWA 安装、N 套 VAPID）。
5. 真正要做的工程集中在两处重写：`src/serve.ts` 的会话生命周期段（单例 → registry）和 `src/client-entry.ts` 的连接状态机（内联单例 → 可实例化工厂）。

## 1. herdr 侧机制确认（文档实证）

- **多 server = 命名 session**：每个 session 是独立 server 进程，socket 在 `~/.config/herdr/sessions/<name>/herdr.sock`；定位顺序：CLI `--session` → `HERDR_SOCKET_PATH` → `HERDR_SESSION` → 默认。socket API 只有本机 Unix socket / 命名管道，**没有原生网络远程协议**。（来源：herdr.dev/docs/socket-api、/docs/concepts）
- **SSH 瘦客户端**：`herdr --remote workbox` / `herdr --remote ssh://you@server:2222`——本地 herdr 作为 thin client 走 SSH 附着远端 herdr server，把整个 TUI 流回本地终端；目标机用标准 SSH config Host 别名。远端 server 持有 pane，SSH 断链 pane 不死，重新 attach 即恢复。（来源：herdr.dev/docs/how-to-work）

## 2. herdweb 现状：五重单例耦合

一个 serve 进程 = 一个 PTY = 一个 WS 端点 = 一个 PWA 安装 = 一套 VAPID，且被安全模型主动加固：

| 耦合点 | 证据 |
|---|---|
| 单 session 闭包变量，PTY 退出即进程退出 | `src/serve.ts:510`、`:733`、`:787`（`await session.onExit`） |
| 浏览器 WS 地址硬编码同源单端点；basePath 是构建期注入常量 | `src/client-entry.ts:27-31`、`build.ts:58/:82` |
| 协议四种 client 消息均无路由字段；`SnapshotMessage.sessionId` 只是新鲜度 UUID，不是路由键 | `src/session-protocol.ts:23`、`:31-36` |
| 客户端连接状态机（socket/epoch/快照门/心跳）全是内联模块级单例 | `src/client-entry.ts:234`、`:253-255`、`:696-697` |
| notify 状态按 port 分目录；VAPID 每端口一套；通知 tag 无 device 维度 | `src/notify/state.ts:16-19`、`src/sw-entry.ts:16` |
| 安全三道闸：CSP 同源 connect-src、Origin==Host、`/api/events` loopback-only；`frame-ancestors 'none'` 封死 iframe 拼接 | `src/serve.ts:174-213`、`src/notify/routes.ts:18-43` |

另注意：WS 协议在架构文档中明文声明「非公开 API，可自由改」（`docs/architecture/networking-and-websockets.md:79`）——这是改造的最大自由度来源。仓内多份设计文档曾**有意识地**把多设备列入不做清单（`docs/designs/weak-network-experience.md:24` 等），本方案是对该范围决策的显式重开，需同步动 GOALS.md。

## 3. HAPI 调研摘要（tiann/hapi，2026-08-23 main）

HAPI = 每台工作机 CLI 出站连中心 hub（Bun + SQLite），手机/浏览器只连 hub；终端是完整 PTY 字节镜像（hub 存 scrollback、订阅回放、无观众停流）；状态走 SSE（全量快照 + 版本化增量 + Last-Event-ID 重连，gap 全量拉）；认证 = 随机 token + QR 配对 + 4h JWT；「E2E 加密」实为 WireGuard 隧道传输层加密，信任模型是「hub 是你自己的机器」。全仓约 40 万行、七端并进。

**留下的借鉴**（在 herdr `--remote` 路线下仍有价值的）：

1. SSE/重连参数表（实践校准值）：心跳 30s / 失联判定 90s / 前台恢复检查 45s / 退避 1s×2 封顶 30s + 0-500ms 抖动 / 后台不重试；
2. **PTY 流与状态流分离**：终端通道保持哑管道，多机切换 UI 由独立轻量状态通道驱动；
3. hub 端 scrollback + 订阅回放 + 空闲停流的模式（与 herdweb 现有 SharedTerminalSession 快照同构）；
4. 版本化字段增量同步（`{version,value}` 水位 + 解析失败全量 refetch 兜底）。

**明确不照搬**：Bun 专属栈、Socket.IO、10+ agent 语义解析适配层（herdweb 定位是通用 PTY 玻璃，不解析 agent 消息）、tunwg 公共 relay、原生推送 relay、本地/远程 handoff 机制。

## 4. 推荐方案

### 4.1 目标形态

一个 herdweb 进程 + 一份 target 列表，单 origin、单 PWA、单 VAPID：

```ts
// 示意，非最终 schema
export default {
  targets: [
    { name: 'local',   command: ['herdr', '--session', 'default'] },
    { name: 'workbox', command: ['herdr', '--remote', 'workbox'] },
    { name: 'mac',     command: ['herdr', '--remote', 'ssh://me@mac'] },
  ],
}
```

每个 target 一个 `SharedTerminalSession`（现有类几乎不动，`src/session.ts:69-142` 封装干净），跨设备的传输/认证/断链恢复全部委托 SSH + herdr thin client。浏览器端切换 target，PWA/通知收敛为一套。

### 4.2 分步路线（每步功能等价、可回滚）

| 步骤 | 内容 | 量级 |
|---|---|---|
| 0 | **零代码验证**：第二个 systemd 实例 `herdweb serve --port 7682 -- herdr --remote <host>`，真机体验远程 target 的手感（延迟、断链恢复、通知） | 配置 |
| 1 | **协议加维**：client 消息加 `sessionId`，新增 attach/detach/list-sessions 控制消息与 `sessions` 事件；服务端仍 N=1 | 小 |
| 2 | **客户端状态机工厂化**：把 `client-entry.ts` 的 socket/epoch/快照门/心跳/pending 缓冲提取为可实例化类；弱网三不变式（GOALS.md M1–M3）重新真机验证 | **最大工作量** |
| 3 | **服务端 registry**：`serve.ts` 单例拆解（session 变量、WS handler 闭包、connections WeakMap、sessionKey、silenceDetector、caffeinate、`onExit` 驱动退出 → 监督策略）；config 加 `targets[]`（动 `types.ts` + `config-schema.ts` 手写校验 + `config-validate.ts`） | 中，集中重写 |
| 4 | **切换 UI + 通知收口**：target 切换入口（可复用 combo-picker/drawer）；通知 tag 与文案加 target 维度；PWA 深链到具体 target | 中 |

### 4.3 明确不做

- 自建 hub / 设备注册表 / 内建认证——SSH config + 密钥就是设备注册表与信任层，herdweb 维持「无内建 auth、靠 Tailscale/SSH 兜底」的立场；
- 浏览器直连多台设备的 ws（要推翻 CSP/Origin 闸，封死）；
- agent 语义消息层（那是在重造 HAPI）。

## 5. 已知缺口与风险

1. **健康通知语义漂移**：远程 target 的 PTY 退出 = SSH 链路断，≠ 远端 session 死（pane 还活着）。health lane 文案/逻辑要区分；`src/notify/health.ts:8-41` 的 sessionKey 解析只认 `herdr --session X`，要教会 `--remote host` 形式。
2. **跨机事件汇聚未解**：远端机器上 agent 的 asking/done 事件（`POST /api/events` loopback-only，README 明文 cross-host 不支持）到不了控制台。廉价解法是 SSH 反向隧道把远端 loopback 转回来；也可先不做——silence lane 基于 PTY 输出，远程模式天然照常工作。
3. **草稿串会话**：`src/controls/asr-preview.ts:40-48` 草稿 key 只按 basePath 分，多 target 下会串，需加维 + migration。
4. **文档契约**：`docs/architecture/` 两篇、`README.md:303-332`、`docs/deploy-herdr.md:88-91` 都是成文的单实例契约，落地必须同步改，否则运维继续按旧约束起多进程。
5. **测试面**：`tests/{session,serve,serve-abuse,client-connection,integration,session-protocol,process-lifecycle}.test.ts` 与 playwright 三个 spec 均锁死单会话生命周期，随步骤重写。
6. **前提**：控制台机器能免密 SSH 到各目标机、目标机装 herdr（现有 Tailscale 网络满足）；`herdr --remote` 的实际断链恢复行为需在步骤 0 真机验证，文档描述 ≠ 实测。

## 6. 参考指针

- herdr 文档：`herdr.dev/docs/socket-api`（socket 路径/协议）、`/docs/concepts`（session 模型）、`/docs/how-to-work`（`--remote` 瘦客户端）
- HAPI：`github.com/tiann/hapi`（hub/、cli/、relay/、`docs/api/client-contract/sse.md` 重连契约）
- 本仓：`docs/architecture/how-herdweb-works.md`、`docs/architecture/networking-and-websockets.md`、`GOALS.md`、`docs/designs/weak-network-experience.md`（曾显式排除多设备的出处）
