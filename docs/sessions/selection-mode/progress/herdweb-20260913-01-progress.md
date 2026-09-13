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
