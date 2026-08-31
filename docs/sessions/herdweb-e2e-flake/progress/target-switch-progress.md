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

## Milestone 3: 修复 WebKit URL 观察方式与红验有效性验证

- 当前阶段：修复 WebKit URL 观察方式与红验有效性验证
- 本段结论：在 `tests/playwright/target-switch.spec.ts` 中，将同步的 `expect(page.url()).toContain('target=two')` 替换为 `await expect.poll(() => page.evaluate(() => window.location.href)).toContain('target=two')`。根因分析明确：`attach-committed` 在客户端执行 `persistUrlTargetId`（即 `history.replaceState`），在 WebKit 手机模拟下，`page.url()` 在 Playwright 端可能因事件分发异步或 CDP/WebKit 驱动层未及时同步而读到旧 URL `?target=one`，直接 evaluate 页面实际的 `window.location.href` 准确反映持久化状态。红验通过注入 `target=wrong` 成功捕获明确断言失败并还原。
- 关键决策与已否决方案：严格使用 `page.evaluate(() => window.location.href)` 检验 URL 是否包含 `target=two`，并保留徽章变 Two、屏幕出现 `target-two-ready`、localStorage `herdweb:lastTargetId:` 以及 reload 后的徽章/屏幕断言；已否决弱化/删除 URL 断言、已否决修改 tap.ts。
- 下一步唯一动作：执行空闲检查并进行 10 轮 WebKit 串行端到端验证，确认 0 失败并将 10 轮结果记入 progress 文档。
