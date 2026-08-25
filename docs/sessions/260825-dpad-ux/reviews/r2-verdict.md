# herdweb d-pad UX（PR #112）R2 复验 verdict

## 范围与结论

- 全量范围：`245c567..b71cfbe`
- 增量专项范围：`133ad07..b71cfbe`
- R1 verdict：`docs/sessions/260825-dpad-ux/reviews/r1-verdict.md`
- 结论：**fail**
- findings：**P1 1 / P2 0 / P3 0**

增量修复基本覆盖了本轮登记的 R1 findings，A–E 核心探针和修复前真实性抽样均达到预期；但普通鼠标短按的 release→click 路径仍没有复用按下时 attachment guard。attachment 在短按释放前切换时，click 会把这次输入静默发到新 attachment，故 R1 P1-1 未完全修复。

## 第一步：增量审（`133ad07..b71cfbe`）

### 1. 是否只修登记在案的 findings

是。增量内容与登记项逐一对应：

- `9048512`：修复 `tests/dpad.test.ts` 的 `querySelectorAll<HTMLButtonElement>` 类型问题，对应 R1 P2-3。
- `296a716`：增加按下时 attachment guard、press 生命周期、active press abort 登记和 timer 清理，对应 R1 P1-1、P1-2、P2-1。
- `b71cfbe`：localStorage 读/删失败时 fail-safe、零尺寸位置 clamp 测试，对应 R1 P2-4、P3-1；同时包含主脑批的四项 OCR 小修：toast z-index `10006`、toast `aria-live`、`base.css:664` 注释、d-pad handle `tabindex="-1"`。

R1 P2-2（`closeComposerOverlays` 关闭 d-pad）不在本轮卡片列出的登记修复集合内，因此本轮不把它计入 findings；该现状仍在 `src/index.ts:326-330`。

### 2. 是否新增未经批准的抽象

否。`pressIsCurrent`、`delayTimer`、`intervalTimer`、`activePressAborts` 是 P1 生命周期修复所必需的状态/登记机制，且本卡明确授权不计为新增无依据抽象。`mockPadRect` 只被新增的零尺寸 clamp 测试消费。未发现其他只被单点声明、没有实际消费者的抽象。

### 3. 状态、事实源、fallback 是否无依据增加

否。新增的 press 状态只服务于按下时 attachment 事实源、延迟发送和关闭/取消时的 abort；`createAttachmentGuard` 复用既有 terminal attachment 事实源。storage catch 只用于本卡要求的 d-pad 可用性 fail-safe，没有新增配置 fallback、重试或静默替代事实源。

### 4. 是否留下双路径

没有发现重复的延迟发送实现：长按、连发和关闭/取消均经过每个 key 的同一组 press 生命周期函数，普通发送仍通过原有 dispatch。**但存在一个 guard 绕行缺口，见下方 P1 finding：普通鼠标 click 是另一条事件入口，尚未接入 press-time guard。**

## 第二步：全量复验（`245c567..b71cfbe`）

### A. 按住连发期间切换 attachment

**通过。**

方法：运行新增 d-pad 生命周期测试 `switching attachment mid-repeat stops the repeat and suppresses release tap`；先按下连发键并推进 timer，再切换 attachment，继续推进 timer，断言发送数量不再增加且 release tap 不发送。当前 b71 测试通过。另用临时 tsx/happy-dom 探针覆盖了同一 timer/attachment guard 路径，结果一致。

边界：上述测试覆盖的是已经进入 hold/repeat 的路径；普通鼠标短按在 release 后产生 click 的边界未被 guard 覆盖，详见 P1-1。

### B. 长按后 mouseleave/touchcancel，再独立短 tap

**通过。**

方法：运行新增 `mouseleave after a fired long-press does not eat the next tap` 测试；长按触发后执行 `mouseleave`，再产生独立 `mousedown`/`mouseup`/`click`，断言得到 `['\\n', '\\r']`。touchcancel 同一 abort 机制由源码和测试覆盖。当前 b71 通过。

### C. 连发中收起 d-pad

**通过。**

方法：运行新增 `closing the pad mid-repeat stops the repeat immediately` 测试；连发已开始时执行 toggle 关闭，再推进 timer，断言发送数量保持不变。当前 b71 通过；toggle 会遍历 `activePressAborts`，清 timer 并清 hold 状态。

### D. 普通短 tap 与 Enter 长按语义

**通过。**

方法：运行 `tests/dpad.test.ts` 全套 39 条，以及 Playwright d-pad 场景；断言普通键短 tap 逐字节发送，Enter 短 tap 为 `\\r`，Enter 长按只发送 `\\n` 并抑制后续 `\\r`。当前单元测试和 Playwright 中的 d-pad 用例均通过。

### E. localStorage get/remove 抛错

**通过。**

方法：运行新增 `storage API failures (getItem/removeItem) never break the d-pad` 测试，分别让 `getItem` 和 `removeItem` 抛错，再打开/关闭 d-pad 并验证控件仍可用、无未捕获异常。当前通过；测试 stderr 中的 storage stack trace 是测试故意打印的 `console.error`，不是未捕获异常。

### F. 熵增维度与真实消费者

**通过。**

全量 diff 中新增的 `DpadConfig` 被 config defaults/schema/resolution 和 d-pad 初始化共同消费；`longPressAction`/`repeatOnHold` 被按键定义、schema、渲染生命周期和测试消费；按压状态由 timer、release/abort 和 toggle close 共同消费；toast、target picker 等全量功能也有对应运行时入口。未发现无消费者的新增配置项或状态。授权的 `activePressAborts` 不计为未经批准的熵增。

### G. 新增回归测试真实性

**通过。**

方法：用临时目录从修复前 `9048512` 导出源码，保留当前测试 fixture，通过 `pnpm exec vitest run` 抽取两条新增测试：

1. `switching attachment mid-repeat stops the repeat and suppresses release tap`
2. `closing the pad mid-repeat stops the repeat immediately`

两条在 `9048512` 均失败，表现为期望发送 3 次、实际发送 13 次；临时目录源码同时确认不存在修复后的 `pressIsCurrent` 哨兵。将测试移除/不加载修复源码的注入也会使断言失败，确认不是恒真测试。临时探针和目录均未写入仓库。

## Findings

### P1-1（R1 P1-1 修复不完整）：鼠标短按 release 后 click 仍可发送到新 attachment

- 溯源：R1 P1-1“延迟/释放发送必须绑定按下时 attachment”；本轮 `296a716` 声称通过 press-time guard 修复。
- 位置：`src/controls/dpad.ts:368-373`、`src/controls/dpad.ts:414-420`、`src/util/tap.ts:93-98`。
- 复现：临时探针在 attachment A 上 `mousedown` Enter，timer 到期前切换到 attachment B，执行 `mouseup` 后触发普通 `click`。结果为 `sent: ["\\r"]`；期望是本次 press 被视为 stale，发送为空。
- 原因：`releasePress()` 清除了 `pressIsCurrent`（`dpad.ts:371`），而 `onAttachmentTap()` 只对 `touchend` 使用 touch guard；普通 `click` 在 `tap.ts:93-98` 直接进入 handler。此时 `holdFired` 仍为 false，`dpad.ts:419` 将短 tap 发到当前的 B。该结果是静默错投输入，违反 R1 P1-1 的按下时 attachment 不变式。
- 建议收口：让鼠标 release 后的 click 与该次 press 共享按下时 guard，并在 click 消费后清理；不要仅依赖 hold/repeat timer 的 guard。

## 验证命令与结果

- `git diff --check 245c567..b71cfbe`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm exec vitest run tests/dpad.test.ts tests/delayed-input-guard.test.ts`：54/54 通过。
- `pnpm test`：73 个文件、1146 条测试通过。
- `pnpm run check`：通过，Biome 检查 188 个文件，无修改。
- `pnpm run lint:knip`：通过。
- `pnpm run lint:ox`：通过，14 条 warning 均为卡片列明的既有 mic/ASR 等存量 warning，无 d-pad warning。
- `pnpm run test:pw`：96 passed、8 skipped、6 failed；失败中 5 条是 Android `page.goto`/beforeEach 环境超时（包含卡片列明的 notify/touch 已知噪声路径），另 1 条是 WebKit target-switch 的一次性 URL 断言失败。针对性重跑 `pnpm exec playwright test tests/playwright/target-switch.spec.ts --project=webkit-iphone -g "badge reflects the current target"`：1/1 通过。Playwright 结果未发现新的 d-pad 用例失败。
- 修复前真实性抽样：临时 worktree 在 `9048512` 上抽取的两条新增回归测试均失败，见 G。

