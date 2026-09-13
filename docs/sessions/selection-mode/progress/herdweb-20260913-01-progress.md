## 里程碑 1：纯文本快照 overlay

- 当前阶段：实现
- 本段结论：完成选择模式控制器与单元测试。快照挂在 `#terminal-container`，内容与终端 DOM 纯文本解耦并保持冻结，支持退出按钮、再次切换和 Esc。
- 关键决策与已否决方案：实测 `window.term` bridge 不暴露 xterm v6 的 `buffer.active.getLine/length`，因此按设计允许的等价读法使用 xterm 自定义滚动条驱动 `.xterm-rows` 遍历完整 scrollback；未修改 `src/client-entry.ts`。
- 下一步唯一动作：接入 `select-mode` action、默认 drawer 按钮和移动端初始化。
