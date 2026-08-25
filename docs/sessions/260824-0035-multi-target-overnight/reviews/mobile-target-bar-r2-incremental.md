# 移动端目标栏 R2 增量审查 verdict

**FAIL** — P1: 0，P2: 1，P3: 0

<!-- delegate-outcome: succeeded -->

## 固定审查对象

| 项 | 值 |
|---|---|
| Task-Id | herdweb-20260825-14 |
| Base (H0) | `fa6a9c40ca6403a246c96ab9c10408f54075c8bc` |
| Head (H1) | `8d541948bb2e4cb3617f30837230d5a0b8e683e5` |
| 范围 | `fa6a9c40..8d54194`（3 commits，8 files，+61/-16） |
| 登记修复目标 | P2-1 safe-area 双计；P3-1 `targetCount` 投影；P3-2 explicit 单 target 自动化 |
| 风险等级 | personal |
| OCR | 任务卡禁止；未跑 |

## 本轮新证据

- 固定增量 `git diff fa6a9c40..8d54194` 全量审读。
- `git show 8d541948` 树内 `src/index.ts`、`src/types.ts`、`build.ts`、`styles/base.css` 与 R1b verdict（`0d575ad` 内 `mobile-target-bar-r1-verdict.md`）对照。
- `node -e` 探针：`HerdwebConfig` 无 `targetCount` 时 `undefined > 1 === false`，多 target 全配置路径静默不渲染 picker。
- `pnpm test tests/client-config-projection.test.ts tests/keyboard-mode.test.ts` @ `8d541948`：**34/34 passed**（单 target 默认配置，未覆盖多 target `init` 路径）。

## 四问（H0..H1 增量审）

### 1. 增量是否只修登记在案的 findings？

**基本成立，附带必要连带改动。**

| 登记项 | H1 对应 | 判定 |
|---|---|---|
| P2-1 dpad/image-drop 去掉重复 `safe-area-inset-bottom` | `b90fe92`：`#wt-dpad` / `#wt-image-drop` 仅保留 `--wt-toolbar-height`（dpad 另加 `--kb-inset`）；`keyboard-mode.test.ts` CSS 契约 | ✅ |
| P3-1 投影 `{id,name}[]` → `targetCount` | `8d54194`：`build.ts`、`types.ts`、`client-config-projection.test.ts` | ✅ |
| P3-2 explicit 单 target 不渲染 badge/picker | `6aa926d`：`target-single.config.ts` + `target-switch.spec.ts` 新用例 | ✅ |

未登记但属 P3-1 连带：`init` 参数扩为 `ClientConfigProjection | HerdwebConfig` 与交集强转（`8d54194`），为保留 vitest 直传 `defineConfig()` 的测试习惯，非独立功能。

R1b backlog **P3-3**（非零 safe-area 几何 PW）本增量未声称修复；`keyboard-mode.test.ts` 字符串断言仅部分缓解，不计入本卡三项。

### 2. 是否新增未经批准的抽象？

**否。** 无新模块、无 wrapper、无配置开关。`targetCount` 为 R1b 已批准减法；`target-single.config.ts` 为测试 fixture；投影测试改为 JSON 解析属测试实现调整，非运行时抽象。

### 3. 是否无依据增加状态、事实源或 fallback？

**否 — 存在无依据双事实源。**

- 运行时事实源：`build.ts` 投影的 `targetCount`（浏览器 `__herdwebConfig`）。
- 测试/嵌入路径：`init(defineConfig(...))` 传入 `HerdwebConfig`，仅有 `targets[]`，**无** `targetCount`。
- `config.targetCount > 1` 在 `targetCount === undefined` 时为 false，不读 `targets.length`；无归一化、无 fail-loud。

生产路径单一且正确；双事实源仅体现在 `init` 边界，属无依据残留。

### 4. 是否留下双路径？

**是。**

| 路径 | 输入 | picker 门控 | 生产可达 |
|---|---|---|---|
| A（浏览器） | `ClientConfigProjection` + `targetCount` | `targetCount > 1` | ✅ |
| B（vitest 等） | `HerdwebConfig` 无 `targetCount` | `undefined > 1` → 恒 false | 仅测试/直调 `init` |

H0 用 `config.targets.length > 1`（投影仍带 `targets[]`）时 A/B 均正确。H1 改读 `targetCount` 后 B 在多 target 全配置下**静默隐藏** picker，与 explicit 多 target 不变式冲突。

## Findings

### P2-1：`init` 双输入契约 — 全配置多 target 静默不渲染 picker

- **违反：** 增量审 Q3/Q4；R1b 不变式「>1 target 应出现 picker/badge」在路径 B 失效。
- **代码：** `src/index.ts:147-156,201` — 签名 `ClientConfigProjection | HerdwebConfig`，强转 `ClientConfigProjection & HerdwebConfig`，门控 `config.targetCount > 1`；`src/types.ts:306` — `HerdwebConfig extends Omit<ClientConfigProjection, 'targetCount'>` 刻意不含 `targetCount`。
- **真实触发：** `init(defineConfig({ targets: [a, b], defaultTargetId: 'a', targetMode: 'explicit' }))` → `targetCount` 为 `undefined` → 无 `.wt-target-picker` / badge；现有 vitest 均默认单 target，CI 假绿。
- **P1 两问：** ① 真实手机浏览器会触发吗？**不会**（`client-entry.ts` / `build.ts` 只注入投影）。② 若触发后果可接受吗？**开发/测试假绿、多 target 单测漏检**，无生产数据丢失，personal **≤P2**。
- **最小修复（减法）：**
  1. 收窄 `init(projectedConfig: ClientConfigProjection)`，删除 `| HerdwebConfig` 与交集强转。
  2. vitest 调用改为 `init({ ...projectClientConfig(defineConfig(...)) })` 或内联 `{ targetCount: cfg.targets.length, ...必要字段 }`（可复用 `build.ts` 的 `projectClientConfig` 测试导出，避免复制投影表）。
  3. **禁止**在 `init` 内加 `targetCount ?? targets.length` 式 fallback — 那会固化双路径而非消除。

## 登记项修复验收

| 项 | 验收 | 备注 |
|---|---|---|
| safe-area 双计 | ✅ | toolbar `offsetHeight` 已含底 padding；dpad/image-drop 不再叠 `env(safe-area-inset-bottom)` |
| `targetCount` 投影 | ✅ | bundle 无 `targets[]`；`client-config-projection.test.ts` 解析 JSON 断言 |
| explicit 单 target | ✅ | PW 断言 badge/picker count=0 |
| `init` 边界一致 | ❌ | 见 P2-1 |

## 验证摘要

| 命令 | 结果 |
|---|---|
| `pnpm test tests/client-config-projection.test.ts tests/keyboard-mode.test.ts` @ `8d541948` | 34/34 |
| 多 target `init(HerdwebConfig)` 探针 | `targetCount > 1` 为 false，`targets.length > 1` 为 true |

## 收口

三项登记修复均已落地，但 `init` 双输入 + `targetCount` 门控留下路径 B 静默退化。合并前按 P2-1 最小减法收窄签名并改测试入参；修后再标 PASS。
