# Target Switch Progress

## Milestone 1: DESIGN-note 落盘

- 当前阶段：DESIGN-note 落盘
- 本段结论：DESIGN-note 原样落盘至 `docs/sessions/herdweb-e2e-flake/design.md`，明确本卡范围仅锁定 WebKit 切换目标后的 URL 持久化与刷新恢复不变式。
- 关键决策与已否决方案：先修切目标单格（4/10），与 Chromium 导航超时串行；已否决跳过单测直接改测试、已否决放宽断言、已否决修改 tap.ts。
- 下一步唯一动作：编写 `persistUrlTargetId` 单测并在 happy-dom 下断言 `replaceState` 行为，先验证单测通过与断言约束力。
