# ci-check-fix progress

## 2026-08-30 F1 展开锁定被引用脚本的有效命令

当前阶段：repairing（F1）

本段结论：parity 现在把 `ci-check` 里每个 `pnpm run X` 展开到 `package.json.scripts.X`，并与锁定表逐字比较。`pnpm exec tsc --noEmit` 不是 `pnpm run`，只锁顶层组成。指定红验 1（`lint:knip`→`true`）与红验 2（`lint:ox`→`echo ok`）均以 AssertionError 转红，旧五项顶层比对仍绿；已按单行还原 `package.json`。

关键决策与已否决方案：锁定表内联常量，读真实 `package.json` 后比对。否决「展开结果非空」或子串包含。否决递归展开 `build:dist` 里的 `build:overlay`（卡面只锁 ci-check 直接引用）。

下一步唯一动作：把 `test-debug-unit.sh` 的 ExecStart 断言改成行锚定整行相等，并做指定红验 3。

## 2026-08-30 F2 ExecStart 行锚定整行相等

当前阶段：repairing（F2）

本段结论：`has()` 改为 `grep -qxF`，ExecStart 必须整行逐字相等。给 unit 追加 ` -- herdr session attach herdweb-dev` 后脚本非零退出（`FAIL: debug command contract changed`），已立刻还原 unit。`Environment=PATH=` 期望串同步写成完整行，否则 `-x` 会对现有合法 unit 误红。

关键决策与已否决方案：用 `grep -qxF` 而不是逐行读。否决只加「不含 ` -- `」的否定断言。`has()` 三个调用共用行锚定，不为 ExecStart 另做包装函数。

下一步唯一动作：加固 `extractJobRunCommands` 识别 `- name` 后接 `run`、去 YAML 引号并规范化空格，再做指定红验 4。

## 2026-08-30 F3 识别 named-step 与 YAML 标量写法

当前阶段：repairing（F3）

本段结论：`extractJobRunCommands` 现在接受 `- name` 后换行 `run:`，并去掉 YAML 引号、把内部空白收成单空格。指定红验 4：把 `- run: pnpm run ci-check` 改成 `- name: CI check` + `run: pnpm run ci-check` 后 parity 仍 6 passed；额外用带引号和双空格的标量也绿。已还原 `ci.yml`，未提交 workflow。

关键决策与已否决方案：继续手写解析器，不引入 YAML 库（本仓无 yaml 依赖，且只抽 check job 的 run 命令）。否决用 fixture 替代真实 `ci.yml`。

下一步唯一动作：在双向 `includes` 比较处写明集合相等契约（接受重排与重复），作为 F4 提交。

## 2026-08-30 F4 写明集合相等契约边界

当前阶段：repairing（F4）

本段结论：双向 `includes` 比较未改。测试里注明该契约是集合相等：接受 `&&` 重排与重复，因为顺序不是契约、重复也不会让十项验证缺失而假绿。

关键决策与已否决方案：无新决策。按锁定决策 4 不改成有序/计数比较。

下一步唯一动作：收尾跑 Verify-Command、vitest 全量、lint/tsc/knip，并写 report.md。
