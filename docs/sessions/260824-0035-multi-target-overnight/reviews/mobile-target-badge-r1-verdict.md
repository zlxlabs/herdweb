# 移动端目标 badge 避让 R1 verdict

## 结论

**FAIL。** H0 没有 P1，但有 1 条未解决的 P2：受支持的双行 toolbar 配置会让粗指针 badge 与 toolbar 相交，违反不变式 1。默认单行 toolbar、Pixel 5/iPhone 粗指针路径和无触控桌面路径均通过；没有观察到个人工具 P1 定义中的数据丢失、静默错结果或崩溃。

## 固定审查对象与范围

- base：`36634fb683e02c844269c0d067b18948d573b308`
- H0：`9ef16dccf2bfccf3eaa81060256534530082f3f1`
- 只审 `base..H0`；固定 diff 为 `styles/base.css` 与 `tests/playwright/target-badge-layout.spec.ts`，85 insertions / 1 deletion。
- 未修改应用代码、测试、配置或既有文档之外的文件；本文件是唯一新增仓库文件。

## Findings

### P2-1：双行 toolbar 时 badge 与 toolbar 相交

- **违反不变式：** 1，粗指针 badge 必须位于现有 toolbar 上方且不相交。
- **代码：** `styles/base.css:520-527` 在粗指针下把 badge 固定为 `bottom: calc(64px + safe-area + --kb-inset)`。这个 64px 只够默认单行 toolbar。toolbar 实际会按 `src/toolbar/toolbar.ts:270-284` 渲染非空的 `row1` 和可选 `row2`，而 `styles/base.css:40-54` 的高度随行数增加。
- **复现证据：** 在 320×568 粗指针页面中，使用 H0 的 `target-switch.config.ts`，再向已渲染 toolbar 注入一个受支持尺寸的 52px 第二行，测得 toolbar 为 `y=456..568`，badge 为 `y=478..504`，矩形相交为 `true`。默认单行时 toolbar 为 `y=512..568`，同一 badge 不相交。
- **影响：** 用户启用 `toolbar.row2` 时，badge 会被 toolbar 的底部行覆盖，目标切换入口可能不可见或不可点击。这是视觉/交互问题，不升 P1，但不是仅理论上的 CSS 风险。
- **建议：** 让 badge 的底部偏移与实际 toolbar 高度绑定，或明确把本轮契约收窄为默认单行并用配置/测试锁住；当前 H0 没有完成其中任一项。

### P3-1：新增布局回归没有锁住 dpad、safe-area 和软键盘边界

- **违反不变式：** 2、3，并间接影响 1。
- **测试：** `tests/playwright/target-badge-layout.spec.ts:13-35` 只断言 badge 在左下半区、与 toolbar 有 4px 间隙；注释提到 dpad，但没有打开 `#wt-dpad` 或比较其 bounding box。`tests/playwright/target-badge-layout.spec.ts:37-49` 只是手动添加 `wt-composer-open`，没有通过真实 voice composer 打开流程，也没有改变 `--kb-inset` 或模拟 safe-area。
- **代码证据：** `styles/base.css:526` 复用了现有 dpad 的 `styles/base.css:603-609` 底部公式；`src/viewport/height.ts:82-100` 写入 `--kb-inset`；`styles/base.css:165-167` 隐藏 composer 打开时的 toolbar 和 badge。因此当前默认路径的静态实现方向正确，但这些边界没有被新增回归锁住，改坏公式或真实 composer 接线时测试仍可能通过。
- **建议：** 增加 dpad 打开后的几何不相交断言，并在实际 composer 打开与 keyboard inset 非零的页面状态下断言 badge；safe-area 可至少断言计算出的左右/底部偏移。

## 关键不变式对应位置

| 不变式 | 实现位置 | 测试/证据 | 判定 |
|---|---|---|---|
| 粗指针左下、toolbar 上方且不相交 | `styles/base.css:495-528`；toolbar 高度 `styles/base.css:40-54`、`src/toolbar/toolbar.ts:270-284` | `tests/playwright/target-badge-layout.spec.ts:13-35`；默认单行通过，双行探针相交 | **FAIL（P2-1）** |
| 右下继续留给 dpad | badge `styles/base.css:524-526`，dpad `styles/base.css:603-609` | 320px、长目标名、dpad open 探针：badge `x=8..136`，dpad `x=148..312`，不相交；新增测试未断言 | **默认路径通过，覆盖不足（P3-1）** |
| safe-area / `--kb-inset` 抬升，composer 不叠加 | `src/viewport/height.ts:43-53,82-100`；`styles/base.css:149-167,520-527` | composer 测试只加 body class；未测非零 inset 或实际 composer | **代码通过，覆盖不足（P3-1）** |
| 细指针/桌面仍右上 | `styles/base.css:495-516`；`src/index.ts:201-210` 保留桌面 badge | `tests/playwright/target-badge-layout.spec.ts:52-70`；`tests/playwright/target-switch.spec.ts:12-43` | **PASS** |

## 熵增审查

H0 只新增一个媒体查询和一个现有 composer 选择器，并新增 3 条 Playwright 布局回归；没有新增 JavaScript 状态、配置项、抽象、fallback、重试或防御式 catch。定位公式复用了已有 dpad 和 `--kb-inset` 逻辑，属于最小实现。P2 的根因正是这个最小固定偏移没有覆盖既有的可选第二行 toolbar，不需要为此引入新的状态层。

## 验证证据

- `pnpm exec playwright test tests/playwright/target-badge-layout.spec.ts --reporter=line`：**6 passed**，覆盖 Chromium Pixel 5、WebKit iPhone 和独立无触控桌面上下文。
- `pnpm test`：**73 files / 1103 tests passed**。
- `pnpm exec biome check styles/base.css tests/playwright/target-badge-layout.spec.ts`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm run lint:knip`：通过。
- `pnpm run lint:ox`：0 errors，14 warnings 均来自本 diff 未修改的既有文件。
- `git diff --check base H0`：通过。
- `pnpm run test:pw --reporter=line`：87 passed、7 skipped、2 failed。失败为并行高负载下 Chromium 的 30 秒 `page.goto` 超时：1 条既有 notify 用例、1 条本新增 composer-hide 用例；新增文件单独运行稳定通过，因此记录为验证环境风险，不据此增加产品 P1/P2。
- `git fetch origin main` 因远端响应超过有界等待而停止；冻结 SHA、本地 H0 和固定 diff 已独立核对，未以移动后的 HEAD 替代审查对象。

## 剩余风险

超窄 viewport 与超长 target name 的 dpad 水平边界仍依赖 `max-width:40vw`；320px 探针没有相交，极窄设备仍值得真机确认。双行 toolbar 的 P2 必须在合入前处理或明确收窄支持契约，否则本 verdict 不应改为 PASS。
