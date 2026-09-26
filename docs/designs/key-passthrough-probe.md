# Herdr 0.9.1 修饰键字节透传探针

这份记录只比较进入 Herdr 客户端 PTY 的字节与 pane raw reader 实际收到的字节，不判断 agent 是否执行了相应语义动作。测量数据位于 [`results/20260926T074149Z-2867790-15878`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/)；[`matrix.txt`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/matrix.txt) 是单行 JSON 索引，按候选、模式、发送组和时间映射收发流。`.hex` 文件只保留字节十六进制和相对单调时钟时间戳，没有 TUI 原文、凭据或环境变量。

## 结论摘要

- Herdr 会按 pane 请求的键盘模式重新编码部分按键。无模式时，多数旧式 CSI、SS3、ESC 前缀和控制字节原样到达；pane 请求 Kitty 或 xterm modifyOtherKeys 后，Herdr 会把输入翻成对应模式的字节。
- Kitty flags 1 与 flags 9 在本矩阵里对修饰键产生相同输出。flags 9 下普通 `a` 仍收到 `61`，没有观察到“所有键都编码成 CSI u”的变化。
- ESC 与后续字节拆开 20ms，对矩阵内的候选没有造成额外差异。裸 `ESC ESC` 即使拆开 100ms 仍只到达一个 Escape 编码；成对的 `CSI 27u` 则能跨四种模式表示两次 Escape。
- Codex 两次 3 秒启动采样都请求 Kitty `CSI > 7u`。Claude 与 pi 的启动输出在两次采样间有差异：Claude 仅第一次出现 xterm modifyOtherKeys 重置序列，pi 仅第一次出现 Kitty `CSI > 7u`；因此不能把单次 3 秒窗口当作稳定的 agent 协议声明。

## 测量方法

探针创建随机 `keyprobe-*` Herdr session 和 `/tmp` workspace，Herdr 服务使用独立 session socket。Node `node-pty` 启动 `herdr --session <keyprobe-name>` 客户端，候选字节写入这个客户端 PTY；pane 内 reader 调用 `stdin.setRawMode(true)`，关闭回显和行缓冲，再将每个收到字节及相对时间写入文件。该链路覆盖 herdweb 生产路径中 `node-pty → herdr 客户端` 这一段。

维度 2 分别为无键盘模式、Kitty `CSI > 1u`、Kitty flags 变体 `CSI > 9u`、xterm modifyOtherKeys 2 `CSI > 4;2m`。reader 在退出时发送 Kitty `CSI < u` 或 xterm `CSI > 4n` 并恢复终端模式。维度 3 对 ESC 开头候选比较一次写入与 ESC/余部拆写（20ms）；裸 `ESC ESC` 另测 100ms，且增加 `CSI 27u` 两连发候选。

判定为“原样”表示 pane 收到字节与输入候选逐字节相同；“改→X”给出 pane 实收的十六进制序列；“未”表示候选窗口内没有字节。每个候选后 reader 都收到一个 `a` 健康标记。四种模式各有 **51/51** 个健康标记、无未归属输入；无模式基线 `a` 与 Ctrl+T 分别收到 `61`、`14`。已配置的 `Ctrl+B` Herdr 前缀未到达 reader，确认读者存活时也能识别被客户端截获的输入。没有找到已知“输入字节改写成另一字节但不触发快捷键”的 Herdr 绑定；按任务卡要求，这个已知截获作为阴性对照，未冒称为字节改写例。

“改写”列是字节事实，不自动表示目标按键不可用。下表以 `原 / 拆20` 依次表示一次写入和 20ms 拆写；`—` 表示候选不以 ESC 开头，因此没有拆写项。裸 `ESC ESC` 行最后一项是额外的 100ms 拆写。每列标题链接到实际发送流和 pane 接收流；`matrix.txt` 给出候选标签与时间映射。

## 候选矩阵

| 目标键 | 写入 Herdr 客户端 PTY 的候选字节 | 无模式 [发送](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/sent-none.hex) · [接收](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/received-none.hex) | Kitty 1 [发送](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/sent-kitty-1.hex) · [接收](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/received-kitty-1.hex) | Kitty 9 [发送](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/sent-kitty-9.hex) · [接收](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/received-kitty-9.hex) | xterm 2 [发送](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/sent-modify-other-keys-2.hex) · [接收](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/received-modify-other-keys-2.hex) |
|---|---|---|---|---|---|
| Alt+↑ | `\x1b[1;3A` | 原 / 原 | 原 / 原 | 原 / 原 | 原 / 原 |
| Alt+↑ | `\x1b\x1b[A` | 原 / 原 | 改→`\x1b[27u\x1b[A` / 同左 | 改→`\x1b[27u\x1b[A` / 同左 | 原 / 原 |
| Alt+↑ | `\x1b[1;3u` | 改→`\x1b\x01` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b\x01` / 同左 |
| Shift+Enter | `\x1b[13;2u` | 改→`\r` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b[27;2;13~` / 同左 |
| Shift+Enter | `\x1b[27;2;13~` | 改→`\r` / 同左 | 改→`\x1b[13;2u` / 同左 | 改→`\x1b[13;2u` / 同左 | 原 / 原 |
| Shift+Enter | `\n` | 原 / — | 改→`\x1b[106;5u` / — | 改→`\x1b[106;5u` / — | 原 / — |
| Alt+Enter | `\x1b\r` | 原 / 原 | 改→`\x1b[13;3u` / 同左 | 改→`\x1b[13;3u` / 同左 | 改→`\x1b[27;3;13~` / 同左 |
| Alt+Enter | `\x1b[13;3u` | 改→`\x1b\r` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b[27;3;13~` / 同左 |
| Alt+, | `\x1b,` | 原 / 原 | 改→`\x1b[44;3u` / 同左 | 改→`\x1b[44;3u` / 同左 | 原 / 原 |
| Alt+, | `\x1b[44;3u` | 改→`\x1b,` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b,` / 同左 |
| Alt+. | `\x1b.` | 原 / 原 | 改→`\x1b[46;3u` / 同左 | 改→`\x1b[46;3u` / 同左 | 原 / 原 |
| Alt+. | `\x1b[46;3u` | 改→`\x1b.` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b.` / 同左 |
| Alt+p | `\x1bp` | 原 / 原 | 改→`\x1b[112;3u` / 同左 | 改→`\x1b[112;3u` / 同左 | 原 / 原 |
| Alt+p | `\x1b[112;3u` | 改→`\x1bp` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1bp` / 同左 |
| Shift+Tab | `\x1b[Z` | 原 / 原 | 改→`\x1b[9;2u` / 同左 | 改→`\x1b[9;2u` / 同左 | 改→`\x1b[27;2;9~` / 同左 |
| Shift+Tab | `\x1b[9;2u` | 改→`\x1b[Z` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b[27;2;9~` / 同左 |
| Ctrl+Space | `\x00` | 原 / — | 改→`\x1b[32;5u` / — | 改→`\x1b[32;5u` / — | 原 / — |
| Ctrl+Space | `\x1b[32;5u` | 改→`\x00` / 同左 | 原 / 原 | 原 / 原 | 改→`\x00` / 同左 |
| F3 | `\x1bOR` | 原 / 原 | 改→`\x1b[13~` / 同左 | 改→`\x1b[13~` / 同左 | 原 / 原 |
| F4 | `\x1bOS` | 原 / 原 | 改→`\x1b[S` / 同左 | 改→`\x1b[S` / 同左 | 原 / 原 |
| F8 | `\x1b[19~` | 原 / 原 | 原 / 原 | 原 / 原 | 原 / 原 |
| Ctrl+Home | `\x1b[1;5H` | 原 / 原 | 原 / 原 | 原 / 原 | 原 / 原 |
| Ctrl+End | `\x1b[1;5F` | 原 / 原 | 原 / 原 | 原 / 原 | 原 / 原 |
| Ctrl+T | `\x14` | 原 / — | 改→`\x1b[116;5u` / — | 改→`\x1b[116;5u` / — | 原 / — |
| Ctrl+O | `\x0f` | 原 / — | 改→`\x1b[111;5u` / — | 改→`\x1b[111;5u` / — | 原 / — |
| Esc Esc | `\x1b\x1b` | 改→`\x1b` / 改→`\x1b` / 同左 | 改→`\x1b[27u` / 同左 / 同左 | 改→`\x1b[27u` / 同左 / 同左 | 改→`\x1b` / 改→`\x1b` / 同左 |
| Esc Esc | `\x1b[27u\x1b[27u`（补充候选） | 改→`\x1b\x1b` / 同左 | 原 / 原 | 原 / 原 | 改→`\x1b\x1b` / 同左 |

## Agent 启动时的协议请求

每个 agent 在独立 `script -q` PTY 中启动，不写入任何 prompt；录制窗口固定为启动后 3 秒，随后由 timeout 结束临时进程。文件只保存匹配到的控制序列十六进制，启动总字节数和匹配数在各次 `matrix.txt` 的 `agents` 数组中。最终完整复跑前后各采样一次：第一次结果在 [`20260926T073538Z-2593398-29596`](../../scripts/probe/key-passthrough/results/20260926T073538Z-2593398-29596/)；第二次矩阵及本表其余字节结论在 [`20260926T074149Z-2867790-15878`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/)。

| Agent | 第一次采样 | 第二次采样 | 结论 |
|---|---|---|---|
| Codex | [`43 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T073538Z-2593398-29596/agent-codex.hex)：`CSI > 7u`、`CSI > 4;0m`、`CSI ? 2004h` 等 | [`43 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/agent-codex.hex)：相同的协议请求 | 两次均请求 Kitty flags 7；均将 xterm modifyOtherKeys 设为 0，并启用 bracketed paste |
| Claude | [`9 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T073538Z-2593398-29596/agent-claude.hex)：含 `CSI > 4m`、`CSI ? 2004h`、`CSI ? 2031h`、`CSI ? 1004h` | [`5 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/agent-claude.hex)：`CSI ? 2004h`、`CSI ? 2031h`、`CSI ? 1004h` 等 | 两次均未出现 Kitty 或 modifyOtherKeys 启用级别；第一次的 `CSI > 4m` 是 xterm modifyOtherKeys 重置序列，第二次未出现 |
| pi | [`6 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T073538Z-2593398-29596/agent-pi.hex)：含 `CSI > 7u`、`CSI ? 2004h`、`CSI ? 2026h` | [`0 条匹配序列`](../../scripts/probe/key-passthrough/results/20260926T074149Z-2867790-15878/agent-pi.hex) | 第一次请求 Kitty flags 7 并启用 bracketed paste / synchronized output；第二次启动字节中没有匹配到键盘协议请求 |

`CSI > 7u` 的 Kitty flags 为 1+2+4；探针的 Kitty flags 变体 `CSI > 9u` 是 bit 1+8。Kitty 规范说明 bit 1 使用 CSI u 表示易歧义按键，bit 8 请求所有按键使用转义编码。[Kitty 键盘协议](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

xterm `CSI > 4;2m` 启用 modifyOtherKeys level 2，`CSI > 4;0m` 关闭它；省略 level 的 `CSI > 4m` 重置该资源。[xterm 控制序列](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)、[xterm modifyOtherKeys 说明](https://invisible-island.net/xterm/xterm.faq.html)

## 后续编码层建议

下表的“发送”是 herdweb 写入 Herdr 客户端 PTY 的字节；pane 输出可能由 Herdr 按 agent 请求的协议改写。

| 目标键 | 建议发送 | 实测 pane 输出 / 限制 |
|---|---|---|
| Alt+↑ | `\x1b[1;3A` | 四种模式均原样。不要选 `\x1b\x1b[A`；Kitty 模式下它变成 Escape 编码加普通 Up 序列。 |
| Shift+Enter | Kitty：`\x1b[13;2u`；xterm 2：`\x1b[27;2;13~` | 分别只在对应模式保留目标编码。无模式下两者都变成普通 CR；实测 Claude 没有启用键盘协议，所以该路径目前无法与 Enter 区分。`
` 对照在 Kitty 模式变成 Ctrl+J 编码。 |
| Alt+Enter | `\x1b\r` | 无模式原样；Kitty 输出 `\x1b[13;3u`；xterm 2 输出 `\x1b[27;3;13~`。 |
| Alt+, / Alt+. / Alt+p | `\x1b,` / `\x1b.` / `\x1bp` | 无模式和 xterm 2 原样；Kitty 输出对应 `CSI 44;3u` / `CSI 46;3u` / `CSI 112;3u`。 |
| Shift+Tab | `\x1b[Z` | 无模式原样；Kitty 输出 `\x1b[9;2u`；xterm 2 输出 `\x1b[27;2;9~`。 |
| Ctrl+Space | `\x00` | 无模式和 xterm 2 原样；Kitty 输出 `\x1b[32;5u`。 |
| F3 / F4 / F8 | `\x1bOR` / `\x1bOS` / `\x1b[19~` | 无模式和 xterm 2 原样。Kitty 下 F3 输出 `\x1b[13~`、F4 输出 `\x1b[S`、F8 原样；Kitty 的功能键表将 F3、F4 分别列为 `CSI 13~` 与省略默认参数的 `CSI S`。[功能键编码表](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) |
| Ctrl+Home / Ctrl+End | `\x1b[1;5H` / `\x1b[1;5F` | 四种模式均原样。 |
| Ctrl+T / Ctrl+O | `\x14` / `\x0f` | 无模式和 xterm 2 原样；Kitty 输出 `\x1b[116;5u` / `\x1b[111;5u`。 |
| Esc Esc | `\x1b[27u\x1b[27u` | Kitty 下两段均原样；无模式和 xterm 2 输出 `\x1b\x1b`。裸 `\x1b\x1b` 在一次写、20ms 拆写、100ms 拆写下都只输出一个 Escape 编码。 |

## 需向 herdr 上游提的问题草稿

1. Herdr 客户端是否承诺按 pane 的 Kitty/xterm 键盘模式转换输入？如果承诺，F3/F4 的当前转换（`ESC O R/S` 到 `CSI 13~` / `CSI S`）是否属于稳定映射？
2. 是否能提供有文档保证的原始字节写入入口，让需要 `Esc Esc` 等序列的调用方绕过客户端快捷键解析？裸双 ESC 在本测量中被合并为一个 Escape 编码。
