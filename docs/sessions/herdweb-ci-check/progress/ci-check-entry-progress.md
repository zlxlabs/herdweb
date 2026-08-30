# ci-check-entry progress

## 2026-08-30 修 debug unit 过期断言

当前阶段：implementing（里程碑 ①）

本段结论：`tests/deploy/test-debug-unit.sh` 的 ExecStart `has` 断言已去掉 `-- herdr session attach herdweb-dev`，与 `systemd/herdweb-debug.service` 实际内容（PR #115）对齐。单跑该脚本 PASS。未改任何 unit 文件。

关键决策与已否决方案：无（按锁定决策 5 改测试不改 unit）。

下一步唯一动作：在 `package.json` 增加 `ci-check` 与 `test:deploy` 脚本并本地跑通。

## 2026-08-30 加 ci-check / test:deploy 脚本

当前阶段：implementing（里程碑 ②）

本段结论：`package.json` 增加 `test:deploy`（三个 `tests/deploy/*.sh`）和 `ci-check`（当前 CI check job 的 9 条验证，`&&` 短路）。`test:deploy` 单跑 PASS。`test:deploy` 尚未链进 `ci-check`，留给里程碑 ⑤ 与 `ci.yml` 一起改，避免 parity 在改 workflow 前红。本机 `typos` 不在 PATH（无 mise），验证时用会话级二进制；`test:pw` 本地 0 retry 会抖，用 `CI=1` 对齐 GitHub Actions 的 2 次重试后 104 passed。

关键决策与已否决方案：ci-check 用 `&&` 串联、不另写脚本文件。否决此刻就把 `test:deploy` 塞进 ci-check（CI 仍逐条列步骤，双向 parity 会红）。否决改 `playwright.config.ts` 的 retries（#62 范围外）。

下一步唯一动作：新增 `tests/ci-entry-parity.test.ts` 并完成双向红验。

## 2026-08-30 加 CI ↔ ci-check 双向 parity 测试

当前阶段：implementing（里程碑 ③）

本段结论：`tests/ci-entry-parity.test.ts` 读仓内真实 `ci.yml` 与 `package.json`，硬编码四条环境准备白名单（含理由），对非白名单步骤与 `ci-check` 组成做双向集合相等。CI 尚未改为唯一入口时走 list-mode；唯一入口后走 `EXPECTED_CI_CHECK_COMMANDS` 锁死组成，避免「CI 只调 ci-check」导致删命令仍绿。正向 5 条全绿。

关键决策与已否决方案：解析 `ci.yml` 用手写 job/`run` 抽取，不引入 YAML 依赖。否决只做 CI→ci-check 单向包含。白名单是精确字符串常量，不是正则。

下一步唯一动作：抽 `assertServeCommandCompatible` + 四格表驱动测试 + unit 契约两层。

## 2026-08-30 抽 CLI 校验纯函数并加 unit 契约两层

当前阶段：implementing（里程碑 ④）

本段结论：`assertServeCommandCompatible` 落到 `src/cli/args.ts`，`cli.ts` 的 serve 路径调用它。四格表驱动覆盖 `single/explicit × 空/非空`。unit 契约层一把两个 unit 的 ExecStart 喂给 `parseCliArgs`；层二在 config 存在时经 tsx+`defineConfig` 加载真实 targetMode（vite 读不了仓外 `.omo/`）。里程碑 ③ 双向红验已完成：删 `ci.yml` 的 `lint:typos`、删 `ci-check` 的 `lint:knip` 均以 AssertionError 转红，已按单行还原。

关键决策与已否决方案：纯函数放 `src/cli/args.ts` 而不是 `cli.ts`（knip project 含 `src/**`，且测试可直接 import）。层二不用 vite `import()`（仓外路径失败）。否决为层二新增生产代码加载器。

下一步唯一动作：`ci.yml` check job 改为 `pnpm run ci-check`，文档 Key Commands 收敛到该入口，并把 `test:deploy` 链进 `ci-check`。

## 2026-08-30 CI 改调 ci-check 且文档收敛到唯一入口

当前阶段：implementing（里程碑 ⑤）

本段结论：check job 环境准备之后只跑 `pnpm run ci-check`；`test:deploy` 已链进 ci-check。`AGENTS.md` / `CLAUDE.md` 的 Key Commands 不再罗列 knip/ox/tsc，提 PR 前只指向 `pnpm run ci-check`。parity 在唯一入口模式下用 `EXPECTED_CI_CHECK_COMMANDS` 锁组成，正向 5 条绿。指定红验 3/4 与层二 skip 均已完成并还原。

关键决策与已否决方案：文档那一行写「与 CI check job 一致、由 parity 测试锁死」，不抄组成。否决在文档里列出 ci-check 内部命令。

下一步唯一动作：收尾跑完整 `pnpm run ci-check` 并写报告。
