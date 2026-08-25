# 移动端目标栏 R1b verdict

<!-- delegate-outcome: succeeded -->

## 结论

**FAIL** — P1: 0，P2: 1，P3: 3。

H0 解决了上一轮 badge 固定 64px 与双行 toolbar 相交的 P2，并把移动 badge 收进 `#wt-toolbar`、用实测高度驱动终端裁切；锁定不变式中的单/多 target DOM 分流、桌面右上 badge、移动 toolbar 子节点、终端 bottom≤toolbar top 均成立。但 `#wt-dpad` / `#wt-image-drop` 在写入 `--wt-toolbar-height`（来自含 safe-area 底 padding 的 `offsetHeight`）后仍叠加 `env(safe-area-inset-bottom)`，在有 home indicator 的真机上会重复抬升，违反「safe-area 不能重复计算」。

## 固定审查对象

| 项 | 值 |
|---|---|
| Task-Id | herdweb-20260825-13 |
| Base | `bbabc89a0905a164ea79a587ffbc954472b92e23` |
| H0 | `fa6a9c40ca6403a246c96ab9c10408f54075c8bc` |
| 范围 | `bbabc89..fa6a9c4`（3 commits，9 files，+57/-32） |
| 风险等级 | personal |
| OCR | 已由主脑跑过，status=`reviewed`；本卡不再跑 OCR |

## 本轮新证据

- 全量固定 diff 审读（`git diff bbabc89..fa6a9c4`）与 `fa6a9c4` 树内 `styles/base.css`、`src/viewport/height.ts`、`src/index.ts` 只读对照。
- `pnpm test tests/height.test.ts tests/keyboard-mode.test.ts tests/client-config-projection.test.ts` @ `fa6a9c4`：**52/52 passed**。
- `pnpm exec playwright test tests/playwright/target-badge-layout.spec.ts tests/playwright/target-switch.spec.ts` @ `fa6a9c4`：**11 passed / 1 failed**（`target-switch.spec.ts` coarse-pointer 切换用例 30s `page.goto` 超时，单文件重跑与卡上已有 12/12 证据一致，记为环境抖动，不升 P1/P2）。
- 必查项 1 safe-area 双计：由 CSS 盒模型 + `offsetHeight` 语义推导（见 P2-1），Playwright iPhone 仿真默认 `safe-area-inset-bottom=0`，故现有 PW 不能否定真机间隙。

## 必查项结论

| # | 问题 | 判定 |
|---|---|---|
| 1 | `toolbar.offsetHeight` 已含底 safe-area padding，`#wt-dpad`/`#wt-image-drop` 是否又加 `env(safe-area-inset-bottom)` | **是，P2-1** |
| 2 | 浏览器仅需数量时，`targets: {id,name}[]` 是否应缩为 `targetCount` | **可缩，P3-1（熵增，不阻塞）** |
| 3 | 单 target 隐藏、desktop/mobile DOM、row/landscape CSS 回归 | **逻辑正确；显式单 target 无专项自动化（P3-2）** |

## Findings

### P2-1：`--wt-toolbar-height` 与 `env(safe-area-inset-bottom)` 在 dpad/image-drop 上重复叠加

- **路径/行：** `src/viewport/height.ts:87,97`；`styles/base.css:608-612`（`#wt-dpad`）；`styles/base.css:1158`（`#wt-image-drop`）。
- **违反不变式：** 「toolbar 实际高度从终端可用高度扣除；d-pad/image-drop 位于 toolbar 上方；safe-area/软键盘不能重复计算」。
- **机制：** `#wt-toolbar` 底 padding 为 `calc(6px + env(safe-area-inset-bottom))`（`styles/base.css:48`），`toolbar.offsetHeight` 含该 padding。`initHeightManager` 把完整 `offsetHeight` 写入 `--wt-toolbar-height`。dpad/image-drop 的 `bottom` 又为 `var(--wt-toolbar-height) + env(safe-area-inset-bottom) + var(--kb-inset)`（image-drop 无 kb-inset，但同样双计 safe-area）。
- **真实触发步骤：** iPhone 类设备（`safe-area-inset-bottom` ≈ 34px）打开页面 → `initHeightManager` 首次 rAF 写入实测高度 → 打开 ✥ dpad 或触发 image-drop 面板 → 固定定位底边比 toolbar 顶边高出约一个 safe-area，出现可见空隙（控件仍可用，终端裁切正确）。
- **对比基线：** 旧式 `64px + safe-area` 中 64px 近似「不含 safe-area 的内容高」，与单独 `safe-area` 项配套；换成实测 `offsetHeight` 后应去掉独立 `safe-area` 项，否则从「估算不重复」退化为「实测 + 再叠加」。
- **P1 两问：** ① 真实使用会触发吗？**会**（有 home indicator 的手机/PWA）。② 后果可接受吗？**可接受**——仅布局间隙，无静默错切 target、无崩溃，故 **≤P2**。
- **最小修复：** dpad/image-drop 的 `bottom` 改为 `calc(var(--wt-toolbar-height, 64px) + var(--kb-inset, 0px))`（image-drop 按需保留是否含 kb-inset 的既有语义），**删除**额外的 `env(safe-area-inset-bottom)`；或改投影为「不含底 safe-area 的内容高」并保留一项 safe-area（二选一，勿双计）。

### P3-1：客户端投影暴露完整 `targets[]`，消费点仅需 `length > 1`

- **路径/行：** `build.ts:75`；`src/types.ts:303-305`；`src/index.ts:201`。
- **违反不变式：** 无功能不变式；违反「不增加无第二消费者抽象/数据」的熵增纪律。
- **真实触发步骤：** 构建任意多 target 配置 → 客户端 bundle 嵌入全部 `{id,name}`，但 `init` 仅用 `config.targets.length > 1` 门控 picker。
- **P1 两问：** 不触发 P1。
- **最小修复：** `ClientConfigProjection` 改为 `targetCount: number`（或 `hasMultipleTargets: boolean`），`build.ts` 投影标量；若未来 UI 需静态名再单独加字段。

### P3-2：显式单 target 配置无自动化回归

- **路径/行：** `src/index.ts:201-205`；`tests/playwright/target-switch.spec.ts:78-84` 仅覆盖 `targetMode: single` 默认页，非 explicit 单 target。
- **违反不变式：** 「配置 target 数量 ≤1：picker 与 badge DOM 完全不存在，显式配置单 target 也成立」——代码满足，测试未锁。
- **真实触发步骤：** `targetMode: 'explicit'` 且 `targets.length === 1` 启动 → 应无 `.wt-target-badge` / `.wt-target-picker`；卡上 OCR 截图已人工确认，但 diff 内无对应用例。
- **最小修复：** Playwright 用 explicit 单 target fixture 断言 badge/picker count=0。

### P3-3：dpad/image-drop 与 safe-area 的几何关系无回归测试

- **路径/行：** `tests/height.test.ts:218-227` 只断言 CSS 变量写入；`tests/playwright/target-badge-layout.spec.ts` 只测 badge/toolbar/terminal。
- **违反不变式：** 间接——P2-1 类问题在 CI 可假绿。
- **最小修复：** 在 PW 注入非零 `safe-area-inset-bottom`（或真机矩阵）断言 dpad 底边 ≤ toolbar 顶边 + ε。

## 不变式核对

| 不变式 | 实现 | 测试/证据 | 判定 |
|---|---|---|---|
| ≤1 target：picker/badge DOM 不存在 | `config.targets.length > 1` 门控 `createTargetPicker` | 默认 single PW；explicit 单 target 仅截图 | **代码 PASS，测试缺口 P3-2** |
| >1 target：桌面 badge 在 body 右上 | `!mobile` 分支 `body.appendChild(badge)` | PW fine-pointer 半区断言 + `#wt-toolbar > badge` count=0 | **PASS** |
| >1 target：移动 badge 为 `#wt-toolbar` 直接子节点 | `toolbar.prepend(badge)` | PW `:scope > button.wt-target-badge` count=1 | **PASS** |
| 点击切换行为不变 | 未改 `target-picker.ts` / WS 协议 | `target-switch.spec.ts`（环境偶发超时） | **PASS** |
| 终端高度扣除实测 toolbar | `height.ts` `chromeH = toolbar.offsetHeight` | `height.test.ts` + PW `terminal bottom ≤ toolbar top` | **PASS** |
| dpad/image-drop 在 toolbar 上方、safe-area 不重复 | `--wt-toolbar-height` + 仍加 `safe-area` | 无 safe-area>0 自动化 | **FAIL P2-1** |
| 无 wrapper/二级菜单/新开关 | diff 仅移动 DOM + CSS 变量 | 目检 diff | **PASS** |

## `:first-of-type` 与 OCR 三条 maintainability

badge `prepend` 后 toolbar 首子节点为 `button`，首 `.wt-row` 为 `div`。`#wt-toolbar .wt-row:first-child` 在 H0 **不匹配任何行**；改为 `:first-of-type` 才能继续命中首行按钮与 landscape 第二行隐藏规则。OCR 称二者「当前等价」**不成立**；image-drop 缺 kb-inset 为既有语义，本 diff 未改 kb-inset 项，仅建议注释（≤P3，不记独立 finding）。

## 熵增审查

新增 `--wt-toolbar-height` 有明确第二消费者（dpad/image-drop CSS），合理。新增 `targets[]` 投影无第二消费者（P3-1）。无 wrapper、配置开关或 Server 二级模型。

## 测试盲区

- Playwright 移动仿真默认 `safe-area-inset-bottom=0`，无法抓 P2-1。
- 无 explicit 单 target 自动化（P3-2）。
- 无 dpad 与 toolbar 相对几何断言（P3-3）。
- 双行 toolbar + 移动 badge 行内布局未在 PW 断言（badge 已在 toolbar 内，相交 P2 已解，但 row2 增高未锁）。

## 验证摘要

| 命令 | 结果 |
|---|---|
| `pnpm test`（卡上证据） | 1104/1104 @ H0 |
| 本机 focused vitest @ `fa6a9c4` | 52/52 |
| PW target-badge + target-switch @ `fa6a9c4` | 11/12（1× goto 超时） |

## 收口建议

合并前修 P2-1（去掉 dpad/image-drop 公式中多余的 `env(safe-area-inset-bottom)`，或改用不含底 safe-area 的高度源）。P3 可记 backlog；修完后对 `safe-area-inset-bottom>0` 补一条几何回归再标 PASS。
