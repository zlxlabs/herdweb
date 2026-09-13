## 里程碑 1：纯文本快照 overlay

- 当前阶段：实现
- 本段结论：完成选择模式控制器与单元测试。快照挂在 `#terminal-container`，内容与终端 DOM 纯文本解耦并保持冻结，支持退出按钮、再次切换和 Esc。
- 关键决策与已否决方案：实测 `window.term` bridge 不暴露 xterm v6 的 `buffer.active.getLine/length`，因此按设计允许的等价读法使用 xterm 自定义滚动条驱动 `.xterm-rows` 遍历完整 scrollback；未修改 `src/client-entry.ts`。
- 下一步唯一动作：接入 `select-mode` action、默认 drawer 按钮和移动端初始化。

## 里程碑 2：动作接入与移动端验收

- 当前阶段：已完成
- 本段结论：新增 `select-mode` 的类型、配置校验、默认 App drawer 入口和 action registry 注入；overlay 在移动端初始化并保持在 `.xterm-screen` 外。Chromium Android 与 WebKit iPhone 的冻结文本、可选计算样式、后续输出隔离、overlay 长按不发右键、退出后右键恢复均通过 Playwright。
- 关键决策与已否决方案：没有改动既有 gestures、`.xterm-screen` CSS、`client-entry` 或 `session`；WebKit 的标准 `userSelect` 属性不可序列化时，验收读取 `-webkit-user-select` 等价计算值。
- 下一步唯一动作：执行红验、跑完整检查并提交本里程碑。

## 里程碑 3：红验与收尾检查

- 当前阶段：已完成
- 本段结论：将挂载点故意改为 `.xterm-screen` 后，Chromium Android 选择模式专项 2 条均按预期失败；失败原文已保存到 `docs/sessions/selection-mode/red-verification-selection-mode.txt`，随后恢复 `#terminal-container`，专项双引擎 4/4 通过。完整单元 82 文件、1461 项通过；覆盖率语句 84.78%、分支 85.48%、函数 92.97%、行 84.78%；构建、类型、格式、静态、发布包与部署契约通过。
- 关键决策与已否决方案：未为完整 Playwright 中未触及本卡的既有 proxy 连接关闭、Chromium offline 重复 resize 失败扩大范围；首轮为 110/124 通过、8 跳过、6 失败，单 worker 重跑相关规格为 41/46 通过、1 跳过、4 失败，新增 selection-mode 规格在两轮均全绿。
- 下一步唯一动作：交接本分支的两个功能提交与验证结论。

## 里程碑 4：使用 xterm buffer API 修复长 scrollback 快照

- 当前阶段：实现并验证
- 本段结论：选择层改用 `term.buffer.active.length` 与 `getLine(index).translateToString(true)` 同步读取完整纯文本；`window.term` bridge 只读转发 `length`、`getLine` 与 `viewportY`。删除了按自定义滚动条比例反推总行数、拖拽滚动和 DOM 行拼接的实现，避免超一屏输出漏行或错位。
- 测试契约：单测用 80 行独立 buffer 内容断言精确行数；Chromium Android 与 WebKit iPhone 用 120 个唯一序号断言首尾、顺序和完整行数，并额外断言快照行数等于 bridge buffer length。
- 红验：临时将循环改为 `index < active.length - 1`，单测 2/4 失败，双引擎超一屏 E2E 2/2 失败（期望 buffer length 123，快照实际 122）；原始输出已追加到 `docs/sessions/selection-mode/red-verification-selection-mode.txt`，随后恢复精确边界。
- 反熵说明：本次仅扩展既有 `XTerminal` bridge 能力和选择层的唯一读取消费者，没有新增运行时抽象；`viewportY` 仅用于恢复进入时的视口位置。
