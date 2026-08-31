# Target Switch Progress

## Milestone 1: DESIGN-note 落盘

- 当前阶段：DESIGN-note 落盘
- 本段结论：DESIGN-note 原样落盘至 `docs/sessions/herdweb-e2e-flake/design.md`，明确本卡范围仅锁定 WebKit 切换目标后的 URL 持久化与刷新恢复不变式。
- 关键决策与已否决方案：先修切目标单格（4/10），与 Chromium 导航超时串行；已否决跳过单测直接改测试、已否决放宽断言、已否决修改 tap.ts。
- 下一步唯一动作：编写 `persistUrlTargetId` 单测并在 happy-dom 下断言 `replaceState` 行为，先验证单测通过与断言约束力。

## Milestone 2: persistUrlTargetId 单测与红验

- 当前阶段：persistUrlTargetId 单测与红验
- 本段结论：在 `tests/target-restore.test.ts` 中补充 `persistUrlTargetId` 针对 URL query 参数设置、更新已存在参数以及 `history.replaceState` 调用的完整单测；注入 `wrong` 故障已确认断言红转绿（AssertionError），单测约束力真实有效。
- 关键决策与已否决方案：单测显式断言 `window.location.search` 和 `window.history.replaceState` 参数；已否决仅断言 localStorage 而漏掉 URL 单测。
- 下一步唯一动作：分析并修复 `tests/playwright/target-switch.spec.ts` 中 WebKit 下 URL 断言对 `window.location.href` 的观察方式，保留全部现有断言与刷新恢复验证。
