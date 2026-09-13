# DESIGN-note：手机端终端文本选择模式

## 目标

让手机端能选中并复制终端里 coding agent 输出的文字，同时保留 herdr 右键菜单能力。

现状：`e7f902b`（PR #171）为解锁 herdr 右键菜单，在 `@media (pointer: coarse)` 下给
`.xterm-screen` 加了 `user-select: none` / `-webkit-touch-callout: none`
（`styles/base.css:32-41`），并在同元素上 `preventDefault()` 掉 `contextmenu`
（`src/gestures/long-press.ts:22-24`），500ms 长按改发 SGR button-2。三者合起来使
手机端完全无法选中终端文本；且该手势无 config 开关（`src/index.ts:382` 硬挂载）。

## 非目标

- 不改 xterm.js 自身的 selection 行为，不与应用侧鼠标协议（herdr 常年 mouse-on，
  `src/session.ts:372-386` 还专门补发 `?1006h`）争抢指针事件。
- 不做 tmux copy-mode 集成、不做 ANSI 颜色保真的富文本选择。
- 不在本方案里取消或削弱长按右键（那属于配套的正确性卡）。
- 不做桌面端行为变更（桌面端 xterm 选择本来可用，且 CSS 改动只在 `pointer: coarse` 下生效）。

## 为什么不是分区 / 删除 / 约定

- **分区**（按手势形状仲裁：调长按阈值、加移动容差、区分单指双指）：单一触摸通道被
  两个消费者（浏览器选择 vs 终端鼠标协议）竞争，靠手势形状分配所有权必然留下误判区间，
  只能搬移概率不能消除。已实测的误判：慢速滚动起手抖动 <10px 且按住 >500ms 会误发右键。
- **删除**（回滚 #171，长按还给系统）：会丢掉刚交付的 herdr 右键菜单能力；且 herdr
  mouse-on 时 xterm.js 把指针事件转成鼠标上报而非选择，单纯撤掉 `user-select: none`
  也换不回可靠的选择体验。
- **约定**（文档写「想复制就用桌面端」）：报障来自真实高频使用路径，不可接受。

结论：加一个**显式状态位**（模式），让同一块屏幕区域在两种模式下归属不同消费者。

## 方案要点与已否决方案

- **要点**：
  1. 新增 `ButtonAction` 类型 `{ type: 'select-mode' }`，默认落在 drawer。
  2. 触发时在 `#terminal-container` 下（**不是 `.xterm-screen` 内部**）浮一层
     `<pre>` 快照，内容取自 `term.buffer.active` 的纯文本（含 scrollback），
     `user-select: text`、`touch-action: auto`、`overflow-y: auto`，字体与终端一致。
  3. 因为 overlay 挂在 `.xterm-screen` 之外，触摸事件的 target 不在手势监听器的
     元素上，长按/滚动/捏合/滑动/双击**天然全部失效**，无需引入额外的手势锁状态。
  4. overlay 顶部一条固定 bar，写明「显示已冻结」并提供退出按钮；再次点入口按钮、
     或按 Esc 也退出。选中后不自动退出，允许连续多次复制。
  5. 进入时按行号把 overlay 滚动位置对齐到终端当前视口；退出即销毁 overlay，
     终端恢复实时显示。

- **已否决**：
  - **引入 `GestureType = 'selection'` 锁**：overlay 的 DOM 位置已提供隔离，
    再加一个状态位属于没有第二消费者的抽象（反熵条款）。
  - **快照只取当前视口**：用户想复制更早的输出就得先退出、滚动、再进入，
    等于把模式切换成本乘以滚动次数。取全 scrollback（上限 5000 行，
    `src/client-entry.ts:264-269`）由 overlay 自身原生滚动。
  - **选中后自动退出**：复制多段时每段都要重新进入，反直觉。
  - **用 `@xterm/addon-serialize` 输出带 ANSI 的文本**：选择模式的目的是拿到可粘贴的
    纯文字，转义序列进剪贴板是负价值。

## 关键不变式

1. [实测] 手势监听器全部绑在 `.xterm-screen` 上（`src/gestures/long-press.ts:112-116`、
   `scroll.ts:371-374`、`pinch.ts:86-93`、`swipe.ts:93-97`、`double-tap.ts:79-83`）——
   overlay 只要不是 `.xterm-screen` 的后代，事件就到不了这些监听器。
2. [实测] `.xterm-screen` 的 `user-select: none` 仅在 `@media (pointer: coarse)`
   生效（`styles/base.css:32-41`），overlay 需要自带 `user-select: text` 覆盖继承。
3. [推断] overlay 存在期间终端仍在接收数据，快照不更新；退出后 xterm 自身的渲染
   已经是最新状态，不需要手工重绘。
4. 选择模式与长按右键互斥且不重叠：overlay 打开时右键手势零触发；overlay 关闭时
   长按行为与本方案落地前完全一致。

## 待验证前提

1. [推断] `term.buffer.active.getLine(i).translateToString(true)` 在 xterm.js v6 上
   可用且返回 trimRight 后的行文本；`buffer.active.length` 含 scrollback。
   执行器需实测确认 API 形状，不符则在 report.md 提出。
2. [推断] iOS Safari / Android Chrome 在 `<pre user-select: text>` 上的长按放大镜与
   系统复制菜单可用，不受祖先 `touch-action: none`（`.xterm-screen` 上，非祖先）影响。
   需在 Playwright webkit-iphone / chromium-android 两 project 下验证选择可达。
3. [推断] 5000 行纯文本 `<pre>` 在移动端的渲染开销可接受；若实测卡顿，
   降级为「当前视口上下各 N 屏」并在 report.md 写明实测数据与所取 N。

## 验收路径

1. 入口：`pnpm run test:pw`（阻断层，chromium-android + webkit-iphone）。
2. 步骤：手机视口下打开终端 → 点 drawer 的选择模式按钮 → 断言 overlay 存在、
   内容含终端文本、`user-select` 计算值为 `text` → 在 overlay 上派发长按序列，
   断言**没有** SGR 右键写入 PTY → 退出 → 断言 overlay 移除且长按右键恢复生效。
3. 预期：上述断言全绿；`pnpm run ci-check` 全绿。

## SOP 合规状态

herdweb 未入 gate-hub `registry.yaml`（无 `has_ui: true`），已提 gate-hub#801 跟踪补标与
`ui-evidence-publish` 接线。录屏层接不上，按 `frontend-test-sop.md` 在 `AGENTS.md` 写
`ui-evidence-exempt:` 声明并挂该单。阻断层无豁免：本批触及的每个面均在 `pnpm run test:pw`
里有断言。
