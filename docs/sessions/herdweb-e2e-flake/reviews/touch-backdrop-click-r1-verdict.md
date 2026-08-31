# Touch backdrop click R1 review verdict

审查对象固定为 `bf8d26d1a44858adf714950b642d0c337e40bfa0..f7ce339298bbff98c9880d1f5713958d46bcedb0`，不包含该范围之外的提交。项目风险等级为 `personal`。

## 结论

**PASS：可以合入。** 本轮没有 P1（数据丢失、静默出错、崩溃）。P2/P3 见「Findings」，均接受不修，不阻塞合入。

## 三条不变式核验

### 1. 真实回归仍被锁死且非恒真：PASS（按项目测试矩阵）

- `tests/playwright/touch.spec.ts:128-151` 仍执行 `toggle.tap()`，随后断言 `#wt-drawer` 有 `open` class。
- `src/util/tap.ts:32-54` 的实际因果链是：touchend 先将模块级 `touchFired` 设为 `true`，再执行 handler；400ms 内 click handler 直接 return。
- `src/drawer/drawer.ts:131-145` 的 `open()` 添加 `open` class，`close()` 删除该 class；因此 final assertion 落在用户可见终态，而不是中间 click 计数器。
- H0 未变异实测：

  ```text
  [webkit-iphone] › tests/playwright/touch.spec.ts:93:1 › synthesised click from tap() hits backdrop (regression guard)
    1 passed (2.5s)
  [chromium-android] › tests/playwright/touch.spec.ts:93:1 › synthesised click from tap() hits backdrop (regression guard)
    1 passed (2.2s)
  ```

- 反向验证前确认 H0 临时 worktree 干净，且被审 guard 已在提交中；仅将 `src/util/tap.ts:43` 的 `touchFired = true` 替换为哨兵注释。注入确认输出为：

  ```text
  42-        // clicks from closing overlays that just opened at the same coordinates.
  43:        // RED-VERIFY: guard disabled for mutation test
  ```

- Chromium 变异的原始转红输出（断言失败而非导入/语法错误）：

  ```text
  Running 1 test using 1 worker
  [1/1] [chromium-android] › tests/playwright/touch.spec.ts:93:1 › synthesised click from tap() hits backdrop (regression guard)
    1) [chromium-android] › tests/playwright/touch.spec.ts:93:1 › synthesised click from tap() hits backdrop (regression guard)

      Error: expect(locator).toHaveClass(expected) failed
      Locator: locator('#wt-drawer')
      Expected pattern: /open/
      Received string: ""
      Timeout: 5000ms
      149 |
      150 |     // But the drawer should still be open (guard blocked the close)
    > 151 |     await expect(page.locator('#wt-drawer')).toHaveClass(/open/)
  1 failed
  ```

- 恢复仅该一行后 Chromium 同一用例重新通过：`1 passed (2.0s)`；临时 worktree 已删除，当前卡工作树干净。
- 补充边界：同一 guard 变异在 WebKit 单项目中通过，原因是本 diff 自己记录的 WebKit LCA 路径把 click 目标置为 `<body>`，不会调用 backdrop 的 `onTap`。这不使项目矩阵恒真，因为启用的 Chromium 项目对 guard 失效会转红；作为 per-browser coverage 边界列为 P2-1，不阻塞本次合入。

### 2. 机理断言仍然有效：PASS

- `tests/playwright/touch.spec.ts:103-125` 在 `tap()` 前注册 capture-phase document click listener；`touch.spec.ts:128-129` 之后唯一的交互生产 click 的动作是 `toggle.tap()`。
- `touch.spec.ts:116-121` 同时记录 `e.isTrusted` 与 `document.elementFromPoint(e.clientX, e.clientY)?.id`；`touch.spec.ts:146-148` 明确要求至少一个 click、首个 click 为 trusted、其坐标命中 `wt-backdrop`。
- 因此断言不是「任意 click 发生」：没有 click 会在 `:146` 失败，脚本 `dispatchEvent`/`element.click()` 产生的非 trusted click 会在 `:147` 失败，坐标未覆盖 backdrop 会在 `:148` 失败。
- H0 WebKit 实测通过，证明新坐标判定确实覆盖原先 `e.target.id === 'wt-backdrop'` 在 WebKit `<body>` LCA 下的失败形态。

### 3. 生产代码零改动：PASS

- `git diff --name-status bf8d26d1a44858adf714950b642d0c337e40bfa0..f7ce339298bbff98c9880d1f5713958d46bcedb0` 仅列出：

  ```text
  A docs/sessions/herdweb-e2e-flake/touch-backdrop-click.md
  M tests/playwright/touch.spec.ts
  ```

- 同范围 `git diff --name-only bf8d26d1a44858adf714950b642d0c337e40bfa0..f7ce339298bbff98c9880d1f5713958d46bcedb0 -- src` 无输出；被审范围没有生产代码改动。

## Findings 分诊

### P2-1：WebKit 单项目的 guard 变异不会转红（接受不修）

- **违反 spec：** 不变式 1 的「guard 失效会转红」若按每个 browser project 独立解释。
- **证据：** WebKit 变异时已确认 `src/util/tap.ts:43` 注入生效；目标用例原始输出为 `1 passed (2.5s)`。恢复后同一用例为 `1 passed (2.3s)`。
- **本仓 P1 两问：** 真实使用方式中 WebKit 的 LCA click 目标是 `<body>`，不会触发 backdrop handler；不会造成数据丢失、静默错误或崩溃。因此不属于 P1。项目矩阵中的 Chromium 同名测试会在 guard 失效时于 `touch.spec.ts:151` 转红。
- **处置：** 接受不修；不要求增加 retries、timeout 或 skip，也不要求扩大本次 diff。

### P3-1：WebKit 守卫因果注释过度概括（接受不修）

- **违反 spec：** 不变式 2 的机理一致性（测试注释与已记录事件路径不完全一致）。
- **证据：** `tests/playwright/touch.spec.ts:101-102` 写成「In both browsers ... touch guard suppresses the onTap click handler」，但同文件改造注释 `:98-100` 以及诊断文档 `touch-backdrop-click.md:41-43` 明确 WebKit click 目标是 `<body>`，该路径不会进入 backdrop 的 `onTap`。
- **处置：** 仅影响维护者理解，不改变断言或运行时行为；接受不修。

### P3-2：诊断文档存在尾随空格（接受不修）

- **违反 spec：** 本次 diff 的文档卫生检查。
- **证据：** `git diff --check bf8d26d1a44858adf714950b642d0c337e40bfa0..f7ce339298bbff98c9880d1f5713958d46bcedb0` 报 `docs/sessions/herdweb-e2e-flake/touch-backdrop-click.md:83: trailing whitespace.`
- **处置：** 不影响测试语义或生产代码，接受不修。

## 其他审查记录

- OCR 前置扫描按固定范围执行，返回 `{"status":"skipped","reason":"no_reviewable_items","findings":[],"coverage":"none"}`；因此不表述为「扫过且干净」，本轮结论来自独立静态审查与实测。
- 熵增检查：未新增生产抽象、状态、配置或 fallback；新增 document probe 是本测试所需的局部观测。`targetId`/`targetTag` 仅随 probe 记录，未参与判定，但不构成阻塞问题。
