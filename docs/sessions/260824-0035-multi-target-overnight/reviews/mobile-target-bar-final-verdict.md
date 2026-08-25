# 移动端目标栏最终收口 verdict

<!-- delegate-outcome: succeeded -->

## 结论

**PASS** — P1: 0，P2: 0，P3: 2。

`bbabc89..4a8e717` 满足四条用户可感知不变式；R1b P2-1（safe-area 双计）与 R2 P2-1（`init` 双输入静默退化）已在 head 修复。生产路径仅消费 `build.ts` 投影的 `targetCount`；`HerdwebConfig` 不保留派生字段。剩余为测试覆盖缺口（P3），不阻塞 personal 档合并。

## 固定审查对象

| 项 | 值 |
|---|---|
| Dispatch-Id | dlg-20260825-073401-c0a739 |
| Base | `bbabc89a0905a164ea79a587ffbc954472b92e23` |
| Head | `4a8e717e0e6d9bf570394e20c9a063dc3e93fa37` |
| PR | #108 |
| 范围 | `bbabc89..4a8e717`（10 commits，15 files，+316/-40，含 3 份 review 文档） |
| 风险等级 | personal |

## 用户不变式核对

| # | 不变式 | 实现 | 测试/证据 | 判定 |
|---|---|---|---|---|
| 1 | ≤1 target：picker/badge 不存在、不占布局高 | `projectedConfig.targetCount > 1` 门控 `createTargetPicker`；无 DOM 则无 `prepend` | PW `target-switch.spec.ts` single mode + explicit 单 target；`target-single.config.ts` | **PASS** |
| 2 | >1 target：粗指针 badge 为 `#wt-toolbar` 直接子节点；细指针仍右上 | 移动 `toolbar.prepend(badge)`；桌面 `body.appendChild(badge)`；CSS `@media (pointer:coarse)` 改 `position:static` | PW `target-badge-layout.spec.ts` `:scope > button.wt-target-badge` count=1（粗）/0（细） | **PASS** |
| 3 | 移动 badge 不挡 herdr 按钮；toolbar 实测高为 terminal/dpad/image-drop 唯一底 chrome；safe-area 不重复 | badge 在 toolbar flex 列内增高 `offsetHeight`；`height.ts` 写 `--wt-toolbar-height`；`#wt-dpad`/`#wt-image-drop` 仅 `var(--wt-toolbar-height)`（dpad 另加 `--kb-inset`） | `height.test.ts` 变量写入；`keyboard-mode.test.ts` CSS 契约（无 `safe-area-inset-bottom`）；PW terminal bottom ≤ toolbar top | **PASS** |
| 4 | 浏览器只消费投影 `targetCount`；`HerdwebConfig` 无派生字段、无 fallback | `build.ts` `targetCount: config.targets.length`；`init(projectedConfig: ClientConfigProjection)`；`HerdwebConfig extends Omit<..., 'targetCount'>`；桥接 `as unknown as HerdwebConfig` 仅 `index.ts` | `client-config-projection.test.ts` JSON 断言 `targetCount`、无 `targets`；`client-entry.ts`/`overlay-entry.ts` 类型为 `ClientConfigProjection` | **PASS** |

## 历史 finding 收口

| Finding | 登记修复 | head 验收 |
|---|---|---|
| R1b P2-1 safe-area 双计 | `b90fe92` 去掉 dpad/image-drop 独立 `env(safe-area-inset-bottom)` | CSS + `keyboard-mode.test.ts` 字符串契约 ✅ |
| R1b P3-1 `targets[]` → `targetCount` | `8d54194` 投影标量 | `client-config-projection.test.ts` ✅ |
| R1b P3-2 explicit 单 target | `6aa926d` fixture + PW | `target-switch.spec.ts` explicit single ✅ |
| R2 P2-1 `init` 双输入静默退化 | `e65ed63` 收窄签名；vitest 显式 `{ ...config, targetCount }` | `git grep init(` @ head：测试均带 `targetCount`；生产仅 `__herdwebConfig` ✅ |
| 最终收口 `HerdwebConfig.targetCount?` | `4fb782d` 删除可选字段 | `types.ts` 无 `targetCount`；仅 `ClientConfigProjection` 持有 ✅ |

## 增量四问（`8d54194..4a8e717`）

| 问题 | 结论 |
|---|---|
| 1. 是否命中原 finding？ | **是。** `e65ed63` 消除 R2 P2-1 双路径；`4fb782d` 移除 `HerdwebConfig.targetCount?`，与任务「不保存派生字段」一致。 |
| 2. 是否引入新边界问题？ | **否。** `as unknown as HerdwebConfig` 为任务允许的显式桥接，门控仍读 `projectedConfig.targetCount`，无 `?? targets.length` 式 fallback。 |
| 3. 测试是否覆盖该边界？ | **部分。** TS 签名强制 `targetCount`；三处 vitest 显式 spread。缺：多 target vitest 直调 `init`、错误入参编译失败用例（依赖 `tsc` 全仓）。 |
| 4. 证据缺口？ | vitest 未复用 `projectClientConfig`，spread 可能与投影表漂移；R1b P3-3（`safe-area>0` 几何 PW）仍未补。 |

## P3 剩余风险（不阻塞）

### P3-1：非零 safe-area 底 inset 无几何 PW

- **路径：** `styles/base.css` dpad/image-drop；`tests/keyboard-mode.test.ts` 仅断言 CSS 源文本。
- **影响：** 公式被改回双计时 CI 可能假绿；personal 真机 home indicator 为真实消费路径。
- **建议：** PW 注入 `safe-area-inset-bottom>0` 后断言 dpad 底边与 toolbar 顶边间隙 ≤ ε。

### P3-2：vitest `init` 入参手拼投影

- **路径：** `tests/font-persistence.test.ts` 等三处 `{ ...config, targetCount: config.targets.length }`。
- **影响：** 投影增删字段时测试可能编译通过但字段缺失；不影响生产。
- **建议：** 改调 `projectClientConfig`（可测试导出）统一入参。

## 验证摘要（卡上证据 + 只读核验）

| 命令/动作 | 结果 |
|---|---|
| `git diff bbabc89..4a8e717` 全量审读 | 完成 |
| R1b/R2 verdict 对照 `4a8e717` 树 | 完成 |
| `pnpm test` @ head（卡上） | 73 files / 1105 passed |
| PW `target-badge-layout` + `target-switch` @ head（卡上） | 14/14 passed |
| `check` / `knip` / `tsc` / `build:dist` / `lint:ox`（卡上） | 通过（ox 14 条既有 warning） |
| head CSS dpad/image-drop `bottom` 公式目检 | 无重复 `safe-area-inset-bottom` |

## 收口

无 P1/P2。PR #108 可按 personal 档合并；P3 记入 backlog，建议合入后补 safe-area 几何 PW。
