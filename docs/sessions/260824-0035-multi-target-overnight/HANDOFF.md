# HANDOFF · 多目标控制台夜间实现

> CEO 与 Eng review 均 CLEAR；本文件给一个全新 Codex session 执行 reviewed design。
> 当前基线为 `main@3d1b144`，工作树干净。本文自包含，持久参考见文末。

## 新 Session Prompt（直接复制）

```text
你在 `/home/zlx/projects/oss/herdweb` 执行 reviewed 的「多目标控制台」设计，目标是在一夜内安全落地尽可能多的内容，并留下可审计的真实证据。始终遵守仓库 AGENTS.md；不要改其他仓库。

背景与边界：CEO review 和 Eng review 已 CLEAR；差异化 Round J/K 均无新增 P1。产品是个人、单用户、单设备使用，尚未正式部署，没有历史兼容负担。当前基线是 `main@3d1b144`，起始工作树应干净。产品是一个单焦点移动控制台，不是远程设备管理平台、多画面监控墙或多连接前端。

先做这些动作：
1. 运行 pickup；`git fetch origin` 后检查 `gh pr list`、`gh pr list --state merged --limit 20`、`git log origin/main --oneline -20`，确认本范围尚未落地。
2. 读取本 prompt 列出的 plan、test plan、任务 JSONL 和 review-discipline；对照当前代码确认实现边界。执行器报告不能替代独立证据。
3. PR0–PR4 是最终可合并、可部署的五个 landing increments。每个 landing increment 创建自己的隔离 worktree/branch，并在分支创建时开 draft PR。同一 increment 内的卡默认在 owning PR worktree 串行做 TDD、小提交、逐 commit push。只有计划明确允许并行的 lane，且文件 ownership 不重叠时，才用独立临时 worktree/branch；完成后由一支笔串行收口到 owning PR，临时并行不构成额外 landing increment。绝不直接写 main，绝不覆盖另一个会话，绝不修改另一个仓库；同一文件或同一分支遵守一支笔原则。
4. 同一文件或同一分支遵守一支笔原则。小选择按第一性原理自动拍板，后来在晨报说明；只有不可逆动作、改变目标，或真正不确定且 blast radius 很大的 UI 选择才问用户。提问前用大白话解释背景、风险和选项差异。

设计与 T0 并行：对 picker/switch states 运行 `$plan-design-review`，同时运行 T0 真实探针和只读代码审计。设计评审要覆盖 loading、empty、error、success、partial、失败恢复、47 字符名称、键盘/触控/返回键和 screen reader。高 blast 的 UI 选择若确实需要用户输入，记录选择和依赖后继续做不依赖它的 server/core 工作，不让整夜停摆。

T0 是真实 gate，不得伪造或绕过：在第二端口执行真实 herdr/SSH probe，验证真实 spawn/SSH、退出码、pane 持久性和当前手机入口，并按仓库约定激活 `GOALS.md` 中的新里程碑和 goal item。缺哪条证据就明确标 blocked；若一个环境探针被卡住，完成其余 probe、design review、test matrices/cards 和所有不依赖该未知量的工作，晨报只报告这一个 blocker，绝不把计划推断写成完成。

17 张卡及依赖如下：T0、T1a、T1b、T2a、T2b、T2c、T3a、T3b、T4a、T4c、T4b、T5、T6a、T6b、T6c、T7、T9。核心串行链是 `T0 → T1a → T1b → T2a → T2b → T2c → T3a → T3b`。核心链完成后开隔离 worktree lanes：
- Lane A：`T4a → T4c → T4b → T5`。
- Lane B：`T6b → T6c`；依赖 T2a/T3b/T4a，且 T6c 必须等待 T4a 的页面 consumer。
- Lane C：T6a，等 T4a 后执行。
三条 lane 收口后再 `T7 → T9`。T7 同时触碰 serve/client ownership，不得与这些 lane 乐观并行。不要以“路径不重叠”为由破坏一支笔原则。

PR 增量每个不超过 3500 行，且每个 PR 必须可部署：PR0 = T0 证据与 GOALS；PR1 = T1a–T3b 核心；PR2 = T4a/T4c/T4b/T5/T6a client/UI；PR3 = T6b/T6c/T7 notify/image；PR4 = T9 docs/evidence。默认串行合并；只有上游本地 funnel 绿，才打开下游乐观工作。卡本身的新增行预算不可突破，超预算立即停手并重设计，不自行扩卡。

实现必须守住这些承重不变式，违反任一条即未完成：
- single 与 explicit 共用一个 `/ws` protocol 2；single 隐藏 picker、自动附着合成的 default；explicit 的 stale/invalid ID 必须 fail loud。
- target 最多 8 个、惰性启动、不得 auto-evict；target 退出只改变该 target 状态，不结束 server 或 caffeinate。
- 每次 attachment 有 generation/capability；geometry → snapshot → 所有 xterm callbacks drain → commit，commit 前不得开输入或写入持久选择。
- HTTP 与 WS 共用 shutdown gate/leases；start/restart barrier、producer join、onExit 清理和 final notification drain 全部完成才退出，晚请求返回明确失败。
- HerdwebConfig 只留在 server；页面只拿逐字段 allowlist 的 client projection，绝不泄漏 command/argv、notify token、VAPID private key 或 channel credential。
- 通知区分 single-v1 与 explicit-v2；producer、schema、dedup、cooldown、history、tag 和点击交付都按 targetId 隔离；不维护旧 worker/server 组合兼容。
- image capability 放专用 header，body/write 前后双 guard；失效、切换、断线或 detach 时不插入，并清理本请求产生的 orphan file。
- mirror、单 WS outbound、client-render backlog 各自有 1 MiB 硬上限；mirror 用既定高低水位 pause/resume，慢 client 只隔离自身 binding。
- 只陈述 herdweb 可证明的本地子进程事实；不得从 SSH argv、连接进程或退出码推断远端 SSH/pane 健康。

测试与 review：每卡先写会失败的测试再实现。跨进程/脚本/文件边界必须断言 producer 实际发出的 WS/HTTP payload、真实 spawn argv 和写入文件的实际 bytes；同进程对象测试不算边界契约。收口前在真实 systemd unit、真实 SSH 和当前手机入口分别验证。至少运行 `pnpm test`、`pnpm run test:pw`、`pnpm run check`、`pnpm run lint:knip`、`pnpm run lint:ox`、`pnpm run build:dist`，适用时运行 `pnpm exec tsc --noEmit`；不把 check 代替 ox/knip。完整加载 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`。infra/state-machine diff 必须经过两轮相邻、视角有差异且无新增 P1 的 review；draft 绿不是完整 gate，标 ready 后核对结论是 SUCCESS 还是 SKIPPED。CI round trip 最多三轮。

夜间调度：执行器一报告就立即 reassign 或 release；某 lane blocked 要记录具体原因并切换到其他 runnable lane，不能等待一条长尾掩盖可做工作。卡超预算就停手重设计。连续两轮各自引出新 finding 时触发 patch-chase fuse，停止零散打补丁，改做系统性不变式和矩阵收口。禁止为“稳妥”添加 fallback、retry、defensive catch 或没有真实第二消费者的抽象。

明确不做：remote structured event bridge；herdr session discovery；terminal thumbnails/multi-view；multi-connection frontend；multi-tenant；旧页面、旧 worker、旧 server 或历史版本兼容。

晨报必须逐项列出：已合并/未合并 PR；17 张卡每张状态和证据；测试与 gate 结果，区分 SUCCESS/SKIPPED；真实 systemd、SSH、手机证据；设计偏离；阻塞原因；worktree/branch；下一条精确动作。证据缺失时只能写 partial/blocked，永远不能声称完成。

持久参考：
- `/home/zlx/.gstack/projects/zlxlabs-herdweb/ceo-plans/2026-08-23-multi-target-console.md`
- `/home/zlx/.gstack/projects/zlxlabs-herdweb/zlx-main-eng-review-test-plan-20260823-234226.md`
- `/home/zlx/.gstack/projects/zlxlabs-herdweb/tasks-eng-review-20260823-234522.jsonl`
- `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
- 仓库设计：`docs/designs/multi-target-console-feasibility.md`（绝对路径为 `/home/zlx/projects/oss/herdweb/docs/designs/multi-target-console-feasibility.md`）。

现场残留只记录，不在本夜间任务清理：hooksPath doctor 无异常。worktree doctor 已检查 7 个，当前可恢复的只有 `/home/zlx/projects/oss/herdweb-worktrees/notify-m4-close` 和 `/tmp/notify-r2-review`。其他 notable non-recoverable：`herdweb-notify` 被 5 个进程占用；`notify-r2` dirty；`notify-swdiag` 未合并且 ahead；`/tmp/herdweb-review-c188960` 有 untracked work。已合并本地分支有 8 个：`card/herdweb-20260823-19`、`card/herdweb-20260823-20`、`card/herdweb-20260823-21`、`card/notify-r2`、`feat/notify-attention`、`feat/notify-m4-close`、`fix/gitignore-local-config`、`fix/notify-content-dedup`。不要清理这些对象；未来 session 先重跑 doctor，并取得清理所需 authority。

接受定义：T0 真实证据和 GOALS 激活可追溯；能合并的 PR 均有真实测试、review、gate 和部署/手机证据；single 与 explicit 的 protocol、切换、通知、图片、背压、shutdown 不变式有测试锁死；剩余卡、证据和 blocker 可被下一 session 精确接手。

拒绝方案：不建 N 条常驻浏览器连接，不做多画面/缩略图，不让 single/explicit 维护两套 wire，不做旧版本兼容矩阵，不把 SSH 连通性冒充远端 pane 健康，不以自动回收、自动重启、fallback/retry 或无第二消费者抽象掩盖未知量。

夜间失败 fallback：若环境、凭据、设备或 CI 阻塞，保留已验证的小提交，转向其他 runnable lane，记录阻塞证据、尝试过的命令和下一动作；不得伪造 T0、systemd、SSH、手机、review、gate 或 completion。最终状态只能是已证实的 `done`、带证据的 `partial` 或带原因的 `blocked`。
```

## 验收定义

- handoff 可直接复制给新 Codex session，且包含 17 张卡、依赖、PR 拆分、门禁、不变式、测试、调度和晨报格式。
- T0 真实探针与 `GOALS.md` 激活是产品代码前置门；任何缺证据状态不得宣称完成。
- 只接受真实 payload/argv/file bytes、真实 systemd/SSH/手机入口和非 SKIPPED 的完整 gate 作为相应证据。

## 已否决选项

- N 条常驻 frontend WebSocket、多画面监控、终端缩略图。
- remote structured event bridge、herdr session discovery、多租户和历史版本兼容。
- 从 SSH argv/退出码推断远端健康；用 fallback、retry、defensive catch 或无第二消费者抽象填补未知量。

## 夜间失败回退

环境阻塞时继续独立 lane、设计评审、测试矩阵和只读审计，留下原始 blocker 与下一动作；不得清理现场、绕过 T0、把 draft 绿当完整 gate，或伪造任何完成、真机、SSH、systemd、review、CI 证据。
