# d-pad 诊断仪表化说明 (herdweb#147)

针对 `tests/playwright/dpad.spec.ts:75`（长按 ⏎ 应发 `0a`）偶发 0 字节失败，在测试层引入 `tests/playwright/dpad-diagnostics.ts`，用于在失败或强制触发时自证故障链路位置。

## 1. 触发方式与开关

- **默认模式（静默）**：用例通过时不输出任何诊断信息，不干扰现有测试时序。仅当断言失败（`testInfo.status !== testInfo.expectedStatus`）时自动 dump。
- **强制 dump 模式**：通过环境变量 `DPAD_DIAG_FORCE=1` 触发，无论通过与否均在结尾 dump 一次：
  ```bash
  DPAD_DIAG_FORCE=1 pnpm exec playwright test tests/playwright/dpad.spec.ts --project=chromium-android -g "holding ⏎"
  ```
- **输出前缀**：所有诊断日志均以前缀 `[dpad-diag]` 输出，且挂载至 `window.__dpadDiag.lastDump` 供 `page.evaluate` 取用。

## 2. 六段诊断数据定义

1. **PTY 屏幕文本快照**（`#terminal .xterm-rows` 同源读法）：回答 PTY 是否收到并回显字节（如 `0a`）。
2. **`window.term?.getConnectionStatus()`**：回答当前连接是否 synced、有无活跃 attachment 与重连故障。
3. **`herdweb-connection-notice` 事件计数与 recent 5 条 detail**：回答是否命中了 send 层丢包通知（`'Not sent — still syncing.'`）。
4. **⏎ / ↓ 按钮事件计数（`pointerdown`/`pointerup`/`mousedown`/`mouseup`/`click`）**：全局委托采集，回答 Playwright 合成按压是否真实到达目标按钮。
5. **WS 出口帧（`framesent` 计数、最近 10 帧 hex payload 与时间戳）**：回答客户端是否向 WebSocket 写入 input 帧及具体字节。
6. **断言期望值 vs 实际值**：期望序列（如 `'0a'`）与屏幕实际文本及匹配判定。

## 3. 三方假说指认矩阵

| 假说 | 第 4 段 按钮事件 | 第 5 段 WS 出口帧 | 第 2/3 段 连接与通知 | 第 1 段 屏幕快照 |
|---|---|---|---|---|
| **(i) 按压未落到按钮**（引擎派发故障） | 全部为 0（`pointerdown=0` 等） | 无对应 input 帧 | 状态正常，无 notice | 无目标字节 |
| **(ii) 客户端 send 层丢包**（守卫 fail-closed） | 正常触发（`pointerdown ≥ 1`） | **无对应 input 帧** | `state !== 'synced'` 或有丢弃 notice | 无目标字节 |
| **(iii) PTY 侧未回显**（服务端/进程故障） | 正常触发（`pointerdown ≥ 1`） | **有对应 input 帧**（含 `\n`） | `synced`，无 notice | 无目标字节 |

## 4. 真实 dump 解读示例

执行 `DPAD_DIAG_FORCE=1 pnpm exec playwright test tests/playwright/dpad.spec.ts --project=chromium-android -g "holding ⏎"` 产出：

```
[dpad-diag] === DPAD DIAGNOSTICS DUMP: holding ⏎ sends \n (0a) and never \r (0d) ===
[dpad-diag] status: forced
[dpad-diag] 1. PTY screen text snapshot:
[dpad-diag]    "bash-5.2$ printf 'byte-ready\\n'; stty -echo -icrnl; while IFS= read -rsn1 -d '' c || [ -n \"$c\" ]; do printf '%02x\\n' \"'$c\"; donebyte-ready0a "
[dpad-diag] 2. Connection status:
[dpad-diag]    {"state":"synced","consecutivePreSyncFailures":0,"lastFailureReason":null}
[dpad-diag] 3. herdweb-connection-notice events:
[dpad-diag]    count: 0, recent: []
[dpad-diag] 4. Button event counts:
[dpad-diag]    ⏎ (enter): pointerdown=1, pointerup=1, mousedown=1, mouseup=1, click=1
[dpad-diag]    ↓ (down):  pointerdown=0, pointerup=0, mousedown=0, mouseup=0, click=0
[dpad-diag] 5. WS outgoing frames:
[dpad-diag]    total sent count: 7
[dpad-diag]    [7] 2026-09-26T15:48:45.417Z hex=7b2274797065223a22696e707574222c2264617461223a225c6e222c226174746163686d656e744964223a226d48457a37677863436a304962697a4d345255713777227d preview="{\"type\":\"input\",\"data\":\"\\n\",\"attachmentId\":\"mHEz7gxcCj0IbizM4RUq7w\"}"
[dpad-diag] 6. Assertion expected vs actual:
[dpad-diag]    expected: "0a"
[dpad-diag]    actual snippet: "bash-5.2$ printf 'byte-ready\\n'; stty -echo -icrnl; while IFS= read -rsn1 -d '' c || [ -n \"$c\" ]; do printf '%02x\\n' \"'$c\"; donebyte-ready0a "
[dpad-diag]    matched: true
[dpad-diag] === END DPAD DIAGNOSTICS DUMP ===
```

- **解读**：第 4 段记录 ⏎ 按钮 `pointerdown=1`、`mousedown=1`，证明 Playwright 按压有效落入按钮；第 5 段帧 7 包含 `\n` input 负载，证明 500ms 长按触发且未被客户端阻断；第 1/6 段屏幕回显 `0a`，断言命中。

## 5. D1 触发源结论（herdweb#147）

失败样本（#147 评论，chromium-android 10 轮第 9 轮）：出口帧 `input(byte-ready) → resize → [1004ms] attach-target → snapshot-applied → ping`，无 `input "\n"`。

第二次 attach 是 **同 target 的 reconnect 重挂**，不是多 target 切换：

1. 某次 `failConnection`（`src/client-entry.ts:752`）把当时仍 synced 的连接打成 disconnected；`invalidateConnection`（`:737`）清掉 `targetId`/`attachmentId`，**保留** `selectedTargetId`。
2. `scheduleReconnect`（`:724-734`）用 `RECONNECT_BACKOFF_MS[0]=1000`，与样本 1004ms 对齐。
3. 新 WS `open` → 服务端 `onOpen` 发 `targets`（`src/serve.ts:717-718`）→ 客户端 `case 'targets'` 用同一个 `selectedTargetId` 调 `beginAttach`（`src/client-entry.ts:921-930`）。
4. 旧守卫 `createAttachmentGuard` 绑的是 attachment id，re-attach 后 `pressStillCurrent` fail-closed 吞掉长按。

已排除：心跳 timeout（15s/25s 对不上 1s）、resize 非 live 当场 `beginAttach`（该 resize 作为出口帧发出了，说明当时 live）、`resumeProbeInFlight`（会先发 ping）、visibility/PWA（60s grace）、同 socket 上服务端主动 `targets`（只在新 WS onOpen 发）。

`failConnection` 的原始 reason 在 dump 时已被第二次 attach-committed 抹掉；本卡不改挂载流程，只把守卫改成按 target 粒度抑制。多余 reconnect 本身记 #147 后续。

