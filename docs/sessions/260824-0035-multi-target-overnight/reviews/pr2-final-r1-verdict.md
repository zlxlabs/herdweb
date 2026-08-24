# PR2 最终终审 R1：producer → WS bytes → PTY

## 固定对象

- base：`c9946698f11cd0f3fbf118f2756e5c1a59d36a18`
- head：`da44d75c829cc19cdca283f734e235a6b70ea1f5`（PR #96 headRefOid 一致）
- 执行器：Codex（`gpt-5.6-luna`）；dispatch：`dlg-20260824-180349` / 报告目录 `20260824-180349-big-codex-multi-target-client-ui`
- **P1 verdict: CLEAN**

## 差异化证据

降层确认：真实 browser bridge 将 `input` / `input-action` 帧绑定到 server-issued `attachmentId`；A 上 touchstart 后切 B，旧 touchend 在 producer 层丢弃，不向 B PTY 写入。B 新 touch 用 B capability；desktop click 仍按当前 attachment 同步发送。

- `sendData` 捕获 `term.getAttachmentId()`（`src/util/terminal.ts:4-10`）；client bridge 序列化 `{ type:'input', data, attachmentId }` 与 composer `input-action`（`src/client-entry.ts:288-351`）。
- 服务端逐连接 capability + `committed && acceptsInput` 校验后才写 PTY（`src/serve.ts:831-851`）。
- 真实 WS payload：`tests/playwright/keyboard-toggle.spec.ts:75-128`；composer bytes：`tests/composer-target-isolation.test.ts:179-190,301-320`。

## 关键不变式（代码 / 测试）

| 不变式 | 代码 | 测试 |
|---|---|---|
| per-identifier touch guard | `src/util/tap.ts:65-98` | `tests/tap.test.ts:109-140` |
| swipe/d-pad/toolbar/drawer/scroll/composer | 各 producer 文件 | `tests/delayed-input-guard.test.ts` + 族内单测 |
| async hook / clipboard / mobile init | toolbar/drawer/actions/index | `tests/mobile-init-guard.test.ts:33-68` |
| composer Send/Retry | `src/controls/asr-preview.ts`, `mic-controller.ts` | `tests/composer-target-isolation.test.ts:269-351` |

reverse-red：移除 guard 会使 delayed-input / composer F1→F2 负断言变红（报告逐项列出）。

## 非 P1（接受不修）

1. P2：`AsrPreview` disposer 与 `onTap` wrapper 生命周期缺口（`src/controls/asr-preview.ts:456-485`）。
2. P2：多数 delayed-input 单测用 recorder 而非真实 bridge；floating/scroll-buttons 缺独立 target-switch e2e（运行时链 + server gate 已核实）。

## 验证

- `git diff --check base..head`：通过；工作树干净。
- 定向 Vitest 5 files / 80 tests；全量 73 files / 1097 tests。
- `pnpm run check` / `lint:knip` / `lint:ox`：0 error。
- Playwright 子集 28/30 首跑（2 例 isolated serve 启动超时）；`--workers=1` 重跑 2/2 通过。

证据：`/home/zlx/.local/state/delegate/20260824-180349-big-codex-multi-target-client-ui/report.md`
