outcome: success

# notify 事件 `level` 四档紧急度

## 任务与结果

- Task-Id：卡面未提供
- Fixes-Issue：卡面未提供
- Base commit：`2301d1d01872597e15e8a9ac5c296ff0729ca905`
- Branch：`card/herdweb-20260904-01`
- Diff-Lines：相对基线 148 行新增、3 行删除，低于 300 行目标和 600 行硬上限
- 结果：`level` 已作为可选字段放行、校验、写入事件 history，并在通知面板显示；未修改 attention policy、channels、service、鉴权/限流或工作流。

## 实现与不变式

- `src/notify/events.ts`
  - `NotifyLevel` 固定为 `act_now | act_soon | collect | fyi`。
  - `ALLOWED_FIELDS` 新增 `level`，未知字段仍 fail-closed。
  - `parseNotifyEvent` 对缺失字段保持原有对象形状；非法字符串、数字和 `null` 均抛出 400 `invalid level`。
  - 合法字段进入解析结果的 `optional` 对象，`JSON.stringify` 后由既有 `appendEventLine` 原样写入 `events.jsonl`。
- `src/controls/notify-panel.ts`
  - 只在 `event.level !== undefined` 时创建 `level` badge；存量无该字段的历史事件不创建空 badge，也不会渲染 `undefined`。
  - badge 展示原始值，`title` 提供含义：`act_now` 立即处理、`act_soon` 尽快处理、`collect` 汇总处理、`fyi` 仅供知悉。
- `docs/configuration.md`
  - 新增 notify event fields 表，记录字段可选性、四个值的含义和“不改变 herdweb outbound gate”。

## 测试覆盖

- 四个合法值均有 `test.each` 通过测试：`act_now`、`act_soon`、`collect`、`fyi`。
- 四类非法值均有拒收测试：`"P0"`、`"ACT_NOW"`、`123`、`null`；均断言 400 和 `invalid level`。
- 不含 `level` 的事件断言 `JSON.stringify(parseNotifyEvent(...))` 与改动前基线对象完全相同，并断言没有自有 `level` 属性。
- HTTP service 测试断言合法 `level` 进入 `events.jsonl`。
- happy-dom 面板测试断言旧事件没有 `level` badge 且文本不含 `undefined`，新事件显示 `level: act_now` 及 `立即处理` tooltip。

## 真实收端契约验证

使用隔离状态目录 `/tmp/herdweb-level-state`，临时实例监听 `127.0.0.1:7691`，命令完成后在同一 shell 中停止实例。生产端口 `127.0.0.1:7681` 未操作。

### 1. 合法 `act_now`

完整命令：

```text
/usr/bin/curl -sS -i -X POST 'http://127.0.0.1:7691/api/events' -H 'content-type: application/json' -d '{"v":1,"id":"level-curl-act-now","kind":"asking","title":"curl level smoke","level":"act_now","ts":'"$(date +%s000)"'}'
```

原始响应：

```text
HTTP/1.1 202 Accepted
content-security-policy: default-src 'self'; script-src 'self' 'nonce-3613974748519138bcc22a85f804a91b'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7691 wss://127.0.0.1:7691 wss://openspeech.bytedance.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(self), geolocation=()
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
content-type: text/plain; charset=UTF-8
Date: Fri, 04 Sep 2026 04:43:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```

### 2. 非法 `P0`

完整命令：

```text
/usr/bin/curl -sS -i -X POST 'http://127.0.0.1:7691/api/events' -H 'content-type: application/json' -d '{"v":1,"id":"level-curl-p0","kind":"asking","title":"curl invalid level","level":"P0","ts":'"$(date +%s000)"'}'
```

原始响应：

```text
HTTP/1.1 400 Bad Request
content-security-policy: default-src 'self'; script-src 'self' 'nonce-3613974748519138bcc22a85f804a91b'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7691 wss://127.0.0.1:7691 wss://openspeech.bytedance.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
content-type: text/plain; charset=UTF-8
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(self), geolocation=()
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
Date: Fri, 04 Sep 2026 04:43:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

invalid level
```

### 3. 缺失 `level`

完整命令：

```text
/usr/bin/curl -sS -i -X POST 'http://127.0.0.1:7691/api/events' -H 'content-type: application/json' -d '{"v":1,"id":"level-curl-legacy","kind":"asking","title":"curl legacy smoke","ts":'"$(date +%s000)"'}'
```

原始响应：

```text
HTTP/1.1 202 Accepted
content-security-policy: default-src 'self'; script-src 'self' 'nonce-3613974748519138bcc22a85f804a91b'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7691 wss://127.0.0.1:7691 wss://openspeech.bytedance.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(self), geolocation=()
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
content-type: text/plain; charset=UTF-8
Date: Fri, 04 Sep 2026 04:43:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```

清理后检查：`PORT_7691_FREE`；生产端口仅保持原有 `PORT_7681_LISTENING`。

## 反向验证原始失败证据

### 移除 `ALLOWED_FIELDS` 中的 `level`

临时删除 `src/notify/events.ts` 白名单中的 `'level'` 后运行：

```text
pnpm exec vitest run tests/notify-events.test.ts -t 'accepts level=act_now'
```

原始失败核心输出：

```text
❯ |dom| tests/notify-events.test.ts (91 tests | 1 failed | 90 skipped)
× parseNotifyEvent > accepts level=act_now
  → unknown field: level

FAIL |dom| tests/notify-events.test.ts > parseNotifyEvent > accepts level=act_now
NotifyEventError: unknown field: level
❯ parseNotifyEvent src/notify/events.ts:165:10
❯ tests/notify-events.test.ts:102:17

Test Files  1 failed (1)
Tests  1 failed | 90 skipped (91)
```

已恢复白名单并重新跑事件测试，回到 `92 passed (92)`。

### 移除非法值校验

临时删除 `if (obj.level !== undefined && !isNotifyLevel(obj.level))` 校验块后运行：

```text
pnpm exec vitest run tests/notify-events.test.ts -t 'rejects invalid level (P0)'
```

原始失败核心输出：

```text
❯ |dom| tests/notify-events.test.ts (91 tests | 1 failed | 90 skipped)
× parseNotifyEvent > rejects invalid level (P0) with 400
  → expected Error: expected throw to be an instance of NotifyEventError

FAIL |dom| tests/notify-events.test.ts > parseNotifyEvent > rejects invalid level (P0) with 400
AssertionError: expected Error: expected throw to be an instance of NotifyEventError
❯ tests/notify-events.test.ts:197:18

Test Files  1 failed (1)
Tests  1 failed | 90 skipped (91)
```

已恢复非法值校验并重新跑事件测试，回到 `92 passed (92)`。

## 最终 `ci-check` 尾部

最终一轮命令为 `pnpm run ci-check`，退出码文件内容为 `0`。实际输出尾部关键行如下：

```text
Test Files  81 passed (81)
Tests  1400 passed (1400)
Start at  12:48:55
Duration  10.01s (transform 3.05s, setup 0ms, collect 7.90s, tests 36.82s, environment 22.48s, prepare 7.45s)

% Coverage report from v8
=============================== Coverage summary ===============================
Statements   : 84.77% ( 9552/11268 )
Branches     : 86.22% ( 2897/3360 )
Functions    : 93.31% ( 726/778 )
Lines        : 84.77% ( 9552/11268 )
================================================================================
$ tsdown && pnpm run build:overlay
✔ Build complete in 1035ms
$ tsx scripts/build-overlay.ts
$ playwright test
Running 118 tests using 6 workers
8 skipped
110 passed (1.3m)
$ biome check .
Checked 205 files in 175ms. No fixes applied.
$ oxlint --import-plugin --promise-plugin
Found 16 warnings and 0 errors.
Finished in 99ms on 90 files with 141 rules using 12 threads.
$ typos
$ knip
$ publint
Running publint v0.3.18 for herdweb...
Packing files with `pnpm pack`...
Linting...
All good!
$ bash tests/deploy/test-debug-unit.sh && bash tests/deploy/test-prod-unit.sh && bash tests/deploy/test-check-exposure.sh
PASS: debug unit and non-enabling installer contracts
serve-prod: production must run from main, got card/test
PASS: production unit, installer split, and serve-prod branch/argv contracts
exposed rc=1
FAIL: 首页暴露 herdweb 应用（status=200 app_features=1）
FAIL: WebSocket 未受保护（status=101；http1.1=true）
PASS: 协议假阴性护栏 http1.1=101 default=101
暴露警告：公网入口仍可直接访问 herdweb，退出码=1
protected rc=0
PASS: 首页需要认证（status=403）
PASS: WebSocket 未完成未认证升级（status=403；http1.1=true）
PASS: 协议假阴性护栏 http1.1=403 default=403
检查结论：公网入口已受身份保护，退出码=0
unreachable rc=2
FAIL: 首页无法判定（网络错误）
FAIL: WebSocket 无法判定（网络错误；http1.1=true）
无法判定：网络或响应状态不足以证明入口已受保护，退出码=2
PASS: exposure check covers exposed, protected, and unreachable local endpoints
```

`exposed` 和 `unreachable` 的 `FAIL` 是部署暴露检查专门覆盖的负向 fixture 输出；最后一行汇总 PASS，且整个 `ci-check` 退出码为 0。

## 提交证据

报告提交前，最新实现测试提交的实际命令输出：

```text
$ git log --oneline -1
d43639d test(notify): cover urgency history rendering

$ git show --stat --format= HEAD
 tests/notify-events.test.ts | 44 +++++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 43 insertions(+), 1 deletion(-)
```

提交链：

```text
d4c101d feat(notify): accept urgency level on events
2a8adf1 feat(notify): show urgency level in history
d43639d test(notify): cover urgency history rendering
```

报告写入前工作树干净，`grep -n "level" src/notify/events.ts` 实际命中白名单、校验和保存逻辑；报告文件将作为下一次独立提交入库。
