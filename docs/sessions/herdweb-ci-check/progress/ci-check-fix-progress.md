# ci-check-fix progress

## 2026-08-30 F1 展开锁定被引用脚本的有效命令

当前阶段：repairing（F1）

本段结论：parity 现在把 `ci-check` 里每个 `pnpm run X` 展开到 `package.json.scripts.X`，并与锁定表逐字比较。`pnpm exec tsc --noEmit` 不是 `pnpm run`，只锁顶层组成。指定红验 1（`lint:knip`→`true`）与红验 2（`lint:ox`→`echo ok`）均以 AssertionError 转红，旧五项顶层比对仍绿；已按单行还原 `package.json`。

关键决策与已否决方案：锁定表内联常量，读真实 `package.json` 后比对。否决「展开结果非空」或子串包含。否决递归展开 `build:dist` 里的 `build:overlay`（卡面只锁 ci-check 直接引用）。

下一步唯一动作：把 `test-debug-unit.sh` 的 ExecStart 断言改成行锚定整行相等，并做指定红验 3。
