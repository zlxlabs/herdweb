# T2c round 2 verdict

固定 H0：`09f862ab85e8773d29d5c91f9d5ffcbdde87e420..e6d9a987eedc1a3dec0afe67d2dec45a90f815f5`。
Node 环境：仓库 `package.json` 声明 `node >=22.0.0`；以 `fnm exec --using=22.23.1` 运行，探针另加 `--unhandled-rejections=strict --trace-uncaught`。
P1 数量：0；是否 clean：是；是否满足两轮收敛：是。infra/state-machine 例外按 personal→internal 计数，round1/round2 相邻且换为真实运行时、反向生命周期视角，均无新增 P1。

## 本轮新证据

- `fnm exec --using=22.23.1 pnpm exec vitest run tests/session.test.ts tests/serve.test.ts --reporter=dot`：2 files、44 tests 全绿。
- 真实 `SharedTerminalSession` + node-pty producer（Node 22）：producer 输出 2,097,152 bytes；延迟 mirror callbacks 时累计 1,052,378 bytes 后 `mirrorPaused=true`；释放 521 callbacks 后实际输出 hash 与期望相同，账本 0、`mirrorPaused=false`、exit `{exitCode:0,signal:0}`，未丢序/崩溃。
- 自然退出反向探针：真实 producer 在 paused 后自然 exit `{exitCode:0,signal:0}`；退出瞬间 `paused=true,pending=1,052,198`，释放 252 个晚 callback 后 `resume()` 1 次、`resumeThrows=[]`，最终账本 0、paused=false，strict unhandled/uncaught 进程正常退出。
- 本地 `WebSocketServer` 的真实 ws：慢 binding 首次 H0 `send` 后同步 `readyState=2 (CLOSING)`；再次 H0 `send` 的 H0 close 次数仍 1、raw.send 次数 0。健康真实 sibling 收到 2 条消息并保持 `readyState=1 (OPEN)`。总 close=2 是 ws 收到 close frame 的内部收尾，不是 H0 重复 close。
- OCR 前置可用性调用返回 `status=skipped/status_missing`；纠正 H0 的第二次调用在 30 秒内未返回 envelope，因此无有效模型 findings，不能表述为已扫描。PR #73 当前 draft `check=FAILURE`，日志查询无新归因；Issue #62 无评论，仍不足以把 3 个 Playwright 超时升为 P1。

## 反向生命周期矩阵

|动作/事实|owner 与覆盖|
|---|---|
|PTY pause|`enqueueMirrorWrite` 达高水位后负责；mirror callback 低于 512 KiB、`dispose`、`failTerminal` 负责 resume。自然 exit 不清 paused，晚 callback 仍是当前恢复 owner。|
|socket close|`createSessionClient.send` 在超 1 MiB 时只关闭当前 raw；`readyState!==OPEN` 守卫阻止后续 send；`onClose` 只移除当前 binding。|
|唯一事实与账本|单实例内 `mirrorPaused`/`terminalFailed` 是行为状态，raw `readyState` 是真实 ws 状态；`pendingMirrorBytes` 只是账本，不能单独替代行为守卫。|

## 意见分诊

### P2：natural exit 的晚 callback 仍会对已退出 PTY 调 resume

- 规格：mirror 高低水位、failure/dispose 不留 paused；personal P1 仅真实入口数据丢失、静默错结果或崩溃。
- 工具/观察标注：真实 Node 22 + node-pty 复现了 paused→natural exit→晚 callback；`resume()` 无同步 throw，strict 进程无崩溃，正常 producer 端到端字节顺序/hash一致。
- 本仓判定：P2，接受不修；该路径的事实行为目前安全，但不是显式 onExit 清理。
- P1 两问：会被真实入口触发吗？会。触发后果能否接受？本机真实 node-pty 下无丢失、静默错结果或崩溃，能接受，故非 P1。

### P2/P3 backlog 与熵增

- P2 死账：规格要求 failure/dispose 不留 paused；工具/观察标注为 round1 failure probe 的 `terminalFailed` guard 与 fail-loud close。本仓判定 P2、接受不修；P1 两问：真实入口会触发吗？失败路径会触发但不造成无界行为。后果能否接受？无数据丢失、静默错结果或崩溃，能接受。
- P3 seam：工具/观察标注为本轮真实 ws probe 需要 `createSessionClient` 的 raw seam；本仓判定 P3、必要且无新状态/机制。P1 两问：会触发真实入口故障吗？不会，seam 只用于绑定测试。后果能否接受？无用户后果，能接受。

## 不变式与锁定位置

- mirror 阈值与行为在 `src/session.ts:11-12,280-303`；`tests/session.test.ts:89,107,136` 锁定高低水位、failure/dispose 恢复。
- 单 WS 字节边界、slow-only close、healthy sibling 在 `src/serve.ts:253-270`；`tests/serve.test.ts:48-76` 锁定 exact UTF-8 limit 与隔离。
- binding 移除在 `src/serve.ts:649-657`；本轮真实 ws probe 补足 readyState/重复行为边界。生产 H0 未变化，未修改生产代码。
