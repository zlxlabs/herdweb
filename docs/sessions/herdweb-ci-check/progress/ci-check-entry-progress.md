# ci-check-entry progress

## 2026-08-30 修 debug unit 过期断言

当前阶段：implementing（里程碑 ①）

本段结论：`tests/deploy/test-debug-unit.sh` 的 ExecStart `has` 断言已去掉 `-- herdr session attach herdweb-dev`，与 `systemd/herdweb-debug.service` 实际内容（PR #115）对齐。单跑该脚本 PASS。未改任何 unit 文件。

关键决策与已否决方案：无（按锁定决策 5 改测试不改 unit）。

下一步唯一动作：在 `package.json` 增加 `ci-check` 与 `test:deploy` 脚本并本地跑通。
