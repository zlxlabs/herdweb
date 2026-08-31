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

## Milestone 4: 10 轮 WebKit 验证与收尾检查

- 当前阶段：10 轮 WebKit 验证与收尾检查
- 本段结论：在空闲检查（`pgrep -af 'playwright|vitest|tsdown'` 无外部进程）后，使用 `env -u CI` 对 `webkit-iphone` 目标用例执行 10 轮串行端到端测试，10 轮全部通过（0 失败、0 unexpected、所有 retry 为 0），耗时稳定在 3.6s–4.3s；同时 `tests/target-restore.test.ts`、`tests/target-picker.test.ts`、桌面与多 target 模式 Playwright 用例、`tsc --noEmit`、`biome check` 全部通过，`playwright.config.ts` 与 `src/util/tap.ts` 零修改。
- 关键决策与已否决方案：严格保留 `env -u CI` 保证 `retries: 0` 真实无重试；10 轮原始 JSON 归档至 `/tmp/herdweb-target-switch-20260831/`；已否决跑 10 轮全量套件以避免污染下一张 Chromium 导航超时卡。
- 下一步唯一动作：编写最终报告写入 `$DELEGATE_REPORT_PATH`，输出执行摘要。

### WebKit 10 轮单用例串行结果

| Round | JSON path | bytes | wall (s) | status | retry | duration (ms) | unexpected |
| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |
| 1 | `/tmp/herdweb-target-switch-20260831/round-1.json` | 3693 | 3.79 | passed | 0 | 1643 | 0 |
| 2 | `/tmp/herdweb-target-switch-20260831/round-2.json` | 3683 | 3.76 | passed | 0 | 1564 | 0 |
| 3 | `/tmp/herdweb-target-switch-20260831/round-3.json` | 3683 | 3.64 | passed | 0 | 1538 | 0 |
| 4 | `/tmp/herdweb-target-switch-20260831/round-4.json` | 3693 | 4.01 | passed | 0 | 1866 | 0 |
| 5 | `/tmp/herdweb-target-switch-20260831/round-5.json` | 3693 | 3.92 | passed | 0 | 1645 | 0 |
| 6 | `/tmp/herdweb-target-switch-20260831/round-6.json` | 3683 | 4.33 | passed | 0 | 1625 | 0 |
| 7 | `/tmp/herdweb-target-switch-20260831/round-7.json` | 3683 | 3.89 | passed | 0 | 1546 | 0 |
| 8 | `/tmp/herdweb-target-switch-20260831/round-8.json` | 3693 | 4.26 | passed | 0 | 1604 | 0 |
| 9 | `/tmp/herdweb-target-switch-20260831/round-9.json` | 3682 | 4.23 | passed | 0 | 1830 | 0 |
| 10 | `/tmp/herdweb-target-switch-20260831/round-10.json` | 3683 | 4.07 | passed | 0 | 1656 | 0 |
