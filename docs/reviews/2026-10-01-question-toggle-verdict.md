# 问卷显隐按钮独立审查

failure-visibility: p2-only

## 审查范围与结论

- Base: `3edec83e05737b0b2cafdf3e290bee87d6849e86`
- 固定 H0: `f663d7d460a54749b9e5575f9438aa3fbf1e177f`
- 风险档：personal；只审固定 diff，不修实现。
- 结论：功能不变式通过；有一条不阻塞的 P2 默认配置文档漂移，无 P1。

## 不变式对照

| 规格 | 代码与测试证据 | 判定 |
|---|---|---|
| 默认 row1 的 Enter 后直接有问卷显隐 | `src/config.ts:86-100` 将 `question-toggle` 放在 Enter 后；`tests/buttons.test.ts`、`tests/config.test.ts` 锁定顺序与标签 | 通过 |
| 每次只发一个 Ctrl+]（0x1d），连续点击逐次发送 | 现有 `send` action 经 `src/toolbar/toolbar.ts` 的 Ctrl 处理和 `sendData`；字母变换不匹配 0x1d。客户端 `onData` JSON 序列化为 input，服务端把原始 data 写入 PTY。unit 精确断言两次发送为 `['\x1d', '\x1d']`；浏览器 PTY 回显每次各一行 `1d`、合计两行 | 通过 |
| Pi 插件处理折叠/恢复；Web UI 不追踪状态、不发 Ctrl+[ / Esc、不加新 action/state | diff 只复用 `{ type: 'send' }`，没有新增状态；`README.md:239-253` 说明只发送 0x1d，并区分取消按键 | 通过 |
| 保留其他控件、聚焦行为并支持手机视口 | 默认顺序测试保留旧控件；既有 send handler 继续执行 `focusIfNeeded`；`agent-keys.spec.ts` 在 Chromium Android 与 WebKit iPhone 验证点击和 PTY 字节。卡面已有手机截图核查：按钮标签未裁切，窄屏延续工具栏横向滚动 | 通过 |
| 默认配置文档准确反映 row1 | `docs/configuration.md:45-46` 示例仍列旧的八项默认按钮，缺少本次新增入口 | 文档漂移，列为 P2 |

## Findings

### P2 — 默认工具栏文档未列出新按钮

本次将默认 row1 从八项增至九项，但 `docs/configuration.md:45-46` 的默认示例仍遗漏问卷显隐；`docs/designs/portrait-toolbar-layout.md:49-67` 仍写八项及 390px 默认不滚。实际窄屏由既有横向滚动承接；卡面截图与本次两浏览器点击测试没有显示问卷显隐标签被裁切。该项是文档/布局约定漂移，不是运行时静默失败，按卡面要求不升为 P1；建议维护者同步默认示例与布局说明，可接受不阻塞本 PR。

### OCR 候选处置

- 布局候选：确认九项布局可能使用既有横向滚动，也确认默认配置文档/布局说明未同步；P2 只记上述文档漂移。OCR 对约 405–410px 的标签宽度是估算，本审查没有把它当作实测数据或运行时缺陷。
- 帮助描述候选：未采纳为 finding。`Show or hide` 描述插件产生的可见效果；同一 PR 的 README 已说明 herdweb 不保存可见状态，并明确区分折叠与取消，未发现与规格冲突的行为。

## OCR 状态

- 命令：`ocr-review --repo "$PWD" --from 3edec83e05737b0b2cafdf3e290bee87d6849e86 --to f663d7d460a54749b9e5575f9438aa3fbf1e177f --audience agent --concurrency 4 --background-file <仓外摘要文件>`
- 退出码：0；envelope：`status=reviewed`，`reason=primary_selected`；按 reviewed 处理，非 skipped。
- OCR 两条候选均已自行核实；处置见上节。

## 复核命令与结果

- `git diff --check 3edec83e05737b0b2cafdf3e290bee87d6849e86..f663d7d460a54749b9e5575f9438aa3fbf1e177f`：退出码 0。
- `./node_modules/.bin/vitest run tests/config.test.ts tests/buttons.test.ts tests/toolbar-actions.test.ts`：退出码 0，3 个文件、64 项通过。
- `./node_modules/.bin/playwright test tests/playwright/agent-keys.spec.ts`：退出码 0，Chromium Android 与 WebKit iPhone 共 8 项通过。
- 红验：`scripts/git/scratch-worktree.sh <herdweb 主仓路径> 3edec83e05737b0b2cafdf3e290bee87d6849e86 -- bash <临时红验脚本>`。临时 base worktree 只覆盖三个测试文件并链接依赖；Vitest 退出码 1，7 项新增/更新断言因 base 缺少 question-toggle 而失败、57 项通过；scratch 脚本已清理临时树。该红由目标断言触发，不是依赖缺失。
- 测试期间仅临时替换本卡 ignored `node_modules` 以直调已安装二进制，退出后已恢复原目录；未运行全量浏览器、未运行生产服务。

## 剩余盲区

- 未运行 Playwright 全量套件；只运行卡面允许的 `agent-keys.spec.ts`。
- CI 真实环境状态由主脑另行核查；本 verdict 不以实现方报告作为证据。
- 未在真实手机上重新量取像素宽度；采用卡面已有截图核查和本地 iPhone/Android 浏览器点击结果。
