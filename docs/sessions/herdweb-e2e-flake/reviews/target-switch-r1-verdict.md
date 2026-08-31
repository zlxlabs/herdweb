# Target switch r1 H0 review verdict

## Verdict

PASS

审查对象固定为 `d20d7cd163dc091a3a4d86e12681e78e7dc8a473..9ef5b13ad75e3c9b66b032bd521cd28a13629f76`。没有发现达到 personal 风险等级 P1 或 P2 的问题，可以合入。

## 对照不变式 1

不变式：点 `two` 之后 `window.location` 含 `target=two`，刷新后仍显示 `Two`。

- `tests/playwright/target-switch.spec.ts` 保留了切换后的 `Two` 徽章和 `target-two-ready` 断言，并把 URL 观察改为 `expect.poll(() => page.evaluate(() => window.location.href)).toContain('target=two')`。断言读取的是页面实际的 `window.location.href`，不是仅依赖 Playwright 的 `page.url()` 投影。
- URL 断言没有被删除，也没有改成恒真表达式。若 `persistUrlTargetId` 没有把 `target=two` 写入页面地址，轮询最终读不到该参数并使测试失败；若写入错误值，同样失败。
- URL 和本地存储断言之后仍有 `page.reload()`，并且 reload 后的 `Two` 徽章与 `target-two-ready` 断言仍在，因此刷新恢复路径没有被削弱。
- H0 中新增的 `tests/target-restore.test.ts` 三个测试分别锁定 URL 参数设置、更新并保留其他参数、以及 `history.replaceState` 的调用参数；这与 `src/target-restore.ts` 的实际 `new URL(window.location.href)` / `replaceState` 路径一致。

## Findings

- P1：无。没有数据丢失、静默出错或崩溃风险。
- P2：无。

## 范围与工具记录

- H0 diff 的生产代码没有变化；未审查 H0 之后的任何提交。
- `git diff --stat origin/main...HEAD` 在写入 verdict 前为空，H0 分支基线没有夹带其他工作树改动；本次唯一新增落盘文件是本 verdict。
- OCR 前置包装器返回 `status=skipped`、`reason=no_reviewable_items`、`coverage=none`。这是未完成扫描的记录，不作为“扫描通过”的依据；本结论来自对 H0 diff、设计不变式、调用方和失败路径的人工审查。
