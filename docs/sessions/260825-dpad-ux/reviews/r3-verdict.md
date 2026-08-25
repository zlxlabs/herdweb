# herdweb d-pad UX（PR #112）R3 终验 verdict

## 范围与结论

- 全量范围：`245c567..adf4750`
- 增量专项范围：`b71cfbe..adf4750`
- R1 verdict：`docs/sessions/260825-dpad-ux/reviews/r1-verdict.md`
- R2 verdict：`docs/sessions/260825-dpad-ux/reviews/r2-verdict.md`
- 结论：**fail**
- Findings：**P1 1 / P2 0 / P3 0**

R2 登记的鼠标 `mouseup → click` 代际缺口已修复，指定验证命令全部通过；但本轮新增的 `pressAborted` 在一次已完成的 click 之后仍可被 `mouseleave` 置真，吞掉随后没有 mousedown 的键盘/裸 click，违反“press 生命周期状态不得泄漏”和既有裸 click 行为，故不能通过。

## 一、增量审（`b71cfbe..adf4750`）四问

### 1. 是否只修 R2 P1-1 登记项

是。`adf4750` 只修改 `src/controls/dpad.ts` 与 `tests/dpad.test.ts`，把 mouse click 接到 mousedown 捕获的 attachment guard，并补充 R2 场景、abort 尾随 click 和干净短 click 测试。没有扩展到 R2 未登记的其他产品行为。

### 2. 是否新增未批准抽象

否。`pressAborted` 是本卡明确授权的收口机制；`pressIsCurrent`、已有 timer 和 `activePressAborts` 继续服务于同一个 press 生命周期。未发现只服务于未来用途的新接口、包装层或配置项。

### 3. 状态/fallback 是否无依据增加

没有新增 fallback、重试或替代事实源。attachment 事实源仍是 `createAttachmentGuard(term)`。但获授权的 `pressAborted` 实现存在生命周期缺陷：`abortPress()` 无条件写入它，即使当前 press 已经由 click 消费完毕或根本没有活跃 press；见 P1-1。

### 4. 是否留下双路径

没有语义分裂。touch 与 mouse 仍以 `term.getAttachmentId()` 为共同事实源：touch 由 `onAttachmentTap()` 的 per-touch guard 校验，mouse click 由同一 press 捕获的 guard 校验；两者都在 attachment 过期时禁止发送。实现位置不同是为了适配 touchend 与合成/真实 click 的事件语义，不是两套发送事实源。

## 二、完备性矩阵

按 `grep -rn "sendData\|dispatch(" src/controls/dpad.ts src/util/tap.ts` 枚举：`tap.ts` 没有直接 `sendData` 或 `dispatch` 出口；d-pad 的直接发送汇聚到 `dispatch()` 的 `sendData()` 分支。

| 出口 | 校验机制 | 测试锁死位置 |
|---|---|---|
| `src/controls/dpad.ts:399` 长按回调 `dispatch(longPressAction)` → `:329 sendData` | 回调先执行 `pressStillCurrent()`（`:397`），失败即清 timer、抑制 release tap | `tests/dpad.test.ts:530-545`；正常长按覆盖于同文件 long-press tests |
| `src/controls/dpad.ts:407` 连发首发 `dispatch(key.action)` → `:329 sendData` | 首发前执行 `pressStillCurrent()`（`:404`） | `tests/dpad.test.ts:507-524` |
| `src/controls/dpad.ts:410` interval tick `dispatch(key.action, false)` → `:329 sendData` | 每个 tick 都执行 `pressStillCurrent()`（`:409`），失败清 interval | `tests/dpad.test.ts:507-524` |
| `src/controls/dpad.ts:444` release tap `dispatch(key.action)` → `:329 sendData` | touchend 由 `src/util/tap.ts:74-81,93-97` 校验 per-touch guard；mouse click 由 `src/controls/dpad.ts:430-443` 校验 mousedown guard | `tests/delayed-input-guard.test.ts:173-190`；`tests/dpad.test.ts:574-595` |
| `src/controls/dpad.ts:331` `deps.executeAction(action)` 的间接发送 | 非 `send` action 不是 d-pad 内直接发送出口；生产 wiring 在 `src/index.ts:274-286` 用 press 时捕获的 generation guard 包住 async `sendWithHooks` | `tests/dpad.test.ts:207-249`；`tests/delayed-input-guard.test.ts` 的 deferred paste guard cases |

## 三、探针复验

- R2 反向场景：`mousedown → attachment A 切 B → mouseup → click` 不发送；通过。
- abort 尾随 click：`mouseleave → click` 不发送；通过。
- 正常短 click：新的 `mousedown → mouseup → click` 发送 `\r`；通过。
- 修复前红验：在临时 `b71cfbe` worktree 注入本轮新增的 mouse-click guard 测试，测试变红，结果为 `expected []`、实际 `['\r']`；证明测试注入生效且不是恒真。临时 worktree 已移除。
- 额外生命周期探针：在 `adf4750` 上先完成一次正常 click，再触发 `mouseleave`，随后执行无 mousedown 的裸 click；第二次 `\r` 未发送，确认 P1-1。

## Findings

### P1-1：已完成 press 后的 `mouseleave` 泄漏 `pressAborted`，吞掉随后键盘/裸 click

- 严重性：P1；置信度：9/10。
- 溯源：本轮核心不变式“press 生命周期状态（`holdFired`/`pressAborted`/guard/timer）不得泄漏到下一次 press”；也是 `adf4750` 为 R2 P1-1 新增的收口状态。裸 click/键盘触发本来属于无 press 的既有豁免行为，但本实现让前一次 pointer 事件改变了它的结果。
- 位置：`src/controls/dpad.ts:366-371`、`:426`、`:430-443`。
- 复现：对 Enter 执行 `mousedown`、`mouseup`、`click`，先得到 `['\\r']`；随后仅派发 `mouseleave`，再执行裸 `click`，结果仍是 `['\\r']`，期望为 `['\\r', '\\r']`。`abortPress()` 在没有活跃 press、且 click 已消费 guard 后仍将 `pressAborted = true`；下一次 click 在 `:443` 被静默 return。
- 影响：真实鼠标完成一次短按后移出按钮即可污染该按钮状态；随后用户用键盘激活同一按钮时，输入被静默丢弃。该状态也可由没有尾随 click 的 cancel/leave 路径留下，违反 press 生命周期隔离。
- 建议：只在确有活跃 press 时登记 abort，或在 press 结束后让 leave/cancel 不再污染下一次无 press 事件；同时保留 `mouseleave → residual click` 的 fail-closed 抑制测试。

## 验证命令与结果

- `grep -rn "sendData\|dispatch(" src/controls/dpad.ts src/util/tap.ts`：完成；确认 d-pad 直接发送汇聚于 `dispatch()`，`tap.ts` 无直接发送出口。
- `pnpm exec vitest run tests/dpad.test.ts -t "switching attachment between mousedown and click|click trailing an aborted press|mouseleave after a fired long-press"`：3 passed。
- `pnpm test`：通过，73 个 test files / 1148 tests passed。
- `pnpm exec tsc --noEmit`：通过，exit 0。
- `pnpm exec playwright test tests/playwright/dpad.spec.ts`：11 passed、1 skipped；webkit 粘贴用例跳过是既有设计行为。
- `git diff --check 245c567..adf4750`：通过。
- `git diff --check b71cfbe..adf4750`：通过。
- 已知噪声未计入 finding：Playwright 全量中的 notify/touch Android `page.goto` 超时、webkit paste 跳过、14 条既有 `lint:ox` mic/ASR warning。

## 最终结论

**Fail。P1 1、P2 0、P3 0。** R2 的目标缺口已收口且测试全绿，但 `pressAborted` 仍能从已结束/非活跃 press 泄漏到后续裸 click，造成真实静默输入丢失。
