# PR2 最终终审 R2：单状态机与边界组合

## 固定对象

- base：`c9946698f11cd0f3fbf118f2756e5c1a59d36a18`
- head：`da44d75c829cc19cdca283f734e235a6b70ea1f5`（PR #96 headRefOid 一致）
- 执行器：GLM（`glm-5.3`）；dispatch：`dlg-20260824-181229` / 报告目录 `20260824-181229-big-glm-multi-target-client-ui`
- **P1 verdict: CLEAN**

## 差异化证据

按红线三问（数据丢失 / 静默错结果 / 崩溃）穷举状态轴：single/explicit 解析、URL/last/default 优先级、picker/restart、attach 握手与 snapshot 缓冲、exit/error、1 MiB render 账本、disconnect/reconnect、延迟输入全路径、draft/pending/mic 按 target 隔离、服务端错 id / sibling 隔离。四层锁定：touchstart capability 捕获 → await 边界 guard → 发帧 synced 闸门 → 服务端逐帧 capability 校验。

## 关键不变式（代码 / 测试）

| 轴 | 代码 | 测试 |
|---|---|---|
| restore 优先级 / blocked | `src/target-restore.ts:46-77` | `tests/target-restore.test.ts:30-70` |
| attach 生命周期 | `src/client-entry.ts:354-376,703-875` | `tests/client-targets.test.ts:260-545` |
| per-identifier fail-closed | `src/util/tap.ts:65-99` | `tests/tap.test.ts:109-140` |
| composer draft/pending | `src/controls/asr-preview.ts`, `mic-controller.ts` | `tests/composer-target-isolation.test.ts:42-353` |
| 弱网 / reconnect | `src/client-entry.ts:645-961` | `tests/playwright/weak-network.spec.ts` |

红验：`createAttachmentGuard` 恒真 → 11 红；`touchendAllowed` 恒真 → 9 红；哨兵 grep 确认注入生效。

## 硬链接红验事故与恢复

红验副本用 `cp -al` 硬链，突变曾写穿工作树 `src/util/tap.ts`（inode 共享）。已 `git checkout -- src/util/tap.ts` 恢复；`git status` 全程为空。恢复后 blob `48aee9d4f9b8599f72ea0d92d78e62f0394f4f7e`（SHA-256 `9e738e6a7a500248a1c6199b8c6e74b91aa41586bfdc3e17eeff29ec619ff2b4`）。受污染窗口 pw 作废；干净树全量 Playwright 与专项复跑无漂移。

## 非 P1（接受不修，3 条 P2）

1. P2-1：受阻恢复对话框缺 CSS，生产层不可见（`styles/base.css` 0 规则 + reconnect overlay 遮挡）。
2. P2-2：`attach-rejected` 非 exited 原因后不自动重连（`src/client-entry.ts:876-886`）。
3. P2-3：`targetId===null` 时误收 sibling `target-status(exited)`（`src/client-entry.ts:796-803`）。

## 验证

- `pnpm test`：73 files / 1097 pass；工作树干净。
- 干净树 `pnpm run test:pw`：81 pass / 7 skip / 0 fail（chromium-android + webkit-iphone）。
- `pnpm run check` / `lint:knip` / `lint:ox`：0 error。
- 工作树与干净树 Playwright 均复核通过。

证据：`/home/zlx/.local/state/delegate/20260824-181229-big-glm-multi-target-client-ui/report.md`
