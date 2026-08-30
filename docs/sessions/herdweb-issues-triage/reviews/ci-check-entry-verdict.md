FAIL

# ci-check-entry review verdict

- 被审 head：`98b286e35d523f4eed497d76f834b4fded6ef396`
- 审查范围：`4b9aa5b8562d241cb6079a4a7fb3306d16eafd4d..98b286e35d523f4eed497d76f834b4fded6ef396`
- 审查时间：2026-08-30T21:12:49+08:00（Asia/Shanghai）
- 风险级别：personal，按任务卡的 infra 例外按 internal 的 P1 判据审查

## Findings

### P1 — parity 只保护字符串组成，不保护 ci-check 的实际验证行为

- 文件:行：`tests/ci-entry-parity.test.ts:150-169`，辅助解析在 `:92-97`。
- 缺陷：测试把 `package.json` 的 `ci-check` 按顶层 `&&` 切成命令字符串，再与固定字符串列表比较；它不展开 `pnpm run X` 对应的 package script，也不执行或观测这些脚本实际会做什么。因此守卫锁住的是写法/引用名，不是终态验证行为。
- 触发场景：保留 `package.json:58` 的 `ci-check` 字符串和 `.github/workflows/ci.yml:22` 不变，把 `package.json` 的 `lint:knip`（或任一被引用的验证脚本）改为 `true`、`echo ok` 等成功但不执行验证的命令 → parity 的十个字符串仍完全匹配，`pnpm run ci-check` 仍以零退出码结束，CI 将报告成功而实际检查缺失。
- `bash scripts/ci-check.sh` 探针：把 `ci-check` 改成该字符串时，解析结果只有 `bash scripts/ci-check.sh`，固定列表中的十项全被报 missing 且 wrapper 被报 extra，测试会红；这证明它拒绝了不同写法，但不能证明 wrapper 或被引用脚本的行为正确。
- P1 两问：会在本项目正常维护 package scripts 的真实路径中触发；后果是验证守卫失效且无错误、后续 PR 的绿色状态可成为假绿，不能接受。
- 建议方向：将 parity 契约下沉到实际执行边界，至少解析并锁定 `ci-check` 引用的 package script 的有效命令图，并增加“把一个被引用脚本替换为成功空操作时测试必须变红”的回归样例；不要只比较顶层字符串。

### P2 — 手写 YAML 提取器把合法的 run 写法误判为 parity 失败

- 文件:行：`tests/ci-entry-parity.test.ts:49-89`、`:150-179`。
- 缺陷：`extractJobRunCommands` 只识别 `- run: ...` 同行形态，或 `run: |` 字面量块；它不识别合法的 `- name: ...` 后接 `run: ...` 多行形态，也不去除 YAML 标量引号或规范化内部空格。
- 触发场景：将 CI 中某条 `- run: pnpm run lint:knip` 改为
  `- name: Knip` / `  run: pnpm run lint:knip` → 该命令不会进入 `checkCommands`，而 `ci-check` 仍含它，parity 在双向比较的 `extraInEntry` 上报红；将它写成 `- run: "pnpm run lint:knip"` 或 `- run: pnpm  run lint:knip` 也会保留引号/多余空格并与真实命令字符串不相等，报红。当前唯一入口若把 `- run: pnpm run ci-check` 改成带 `name:` 的同类写法，也会因漏读入口而报红。
- 判定：这些输入仍执行同一检查，红色结果是误拒而非保护性失败；这是 P2，不是 P1，因为它 fail-loud，不会制造假绿。
- 建议方向：在不引入无必要依赖的前提下，让提取逻辑覆盖仓库允许的 YAML `run` 形态并对 YAML 标量做最小规范化；为命名多行步骤和带 YAML 引号的同命令加回归样例。

### P3 — includes 集合比较丢失重复步骤和顺序信息

- 文件:行：`tests/ci-entry-parity.test.ts:161-166`、`:172-177`。
- 缺陷：两侧都用 `includes` 做成员资格判断，没有比较计数或顺序，因此命令字符串不是唯一的步骤身份。
- 触发场景：在旧的逐条 CI 形态中保留全部验证步骤，再额外添加第二条 `pnpm run lint:ox` → `verificationCommands` 含两个相同值，但每个都能在 `ciCheckCommands` 中找到，测试仍绿，尽管 CI 多执行了一条未被 `ci-check` 表示的步骤；在 `ci-check` 中重复一条已有命令或调换命令顺序也会绿。`pnpm run X` 与 `pnpm exec X` 只要单侧变化则会红，这是精确字符串身份下的正确拒绝。
- 判定：重复步骤不会漏掉当前十项验证，顺序也不在本卡明确锁定的“集合相等”契约内，因此不升级为 P1/P2；这是集合语义的非阻断限制。
- 建议方向：若产品契约要求锁定步骤基数或 `&&` 顺序，改用有序数组/计数比较并补对应回归；若契约只要求集合，显式记录接受重复与重排的边界。

### P2 — debug unit 的 ExecStart 断言从整行契约退化为前缀契约

- 文件:行：`tests/deploy/test-debug-unit.sh:8-11`。
- 缺陷：`has` 使用未锚定的 `grep -F` 子串匹配。被审改动删掉旧的 trailing command 后只更新了期望前缀，没有断言 `ExecStart` 行在 config 路径处结束，也没有断言不存在 ` -- ` 分隔符。
- 触发场景：将 `systemd/herdweb-debug.service:12` 改成当前前缀再追加 ` -- herdr session attach herdweb-dev`（或任意额外参数）→ `test-debug-unit.sh` 仍通过。若本地调试配置是 `single` 模式，CLI 会接受 trailing command 并把调试后端切到该命令，静态契约守卫报告绿但实际 unit 行为已变；若配置是 `explicit` 模式，运行时 guard 会响亮失败，但静态断言仍未锁死 unit 内容。
- 判定：当前 unit 的固定内容确实包含该前缀，断言没有宽到“什么都能过”；但它允许本应被契约禁止的尾部漂移，属于 P2 假绿。按仓库实际文档中的显式多目标调试配置，常见路径会 fail-loud，故不升级为 P1。
- 建议方向：对完整 `ExecStart=` 行使用行锚定的精确比较，或至少增加对 ` -- `/尾部参数的否定断言。

## 降层三问

### 1. 保护的是写入还是行为？

结论：当前保护的是 `ci-check` 顶层字符串组成，不是实际执行行为。见上方 P1；`bash scripts/ci-check.sh` 会被字符串守卫拒绝，但引用脚本改为空操作不会被发现。

### 2. 守卫用的值自身唯一吗？

结论：步骤身份是未规范化的命令字符串，既会因合法 YAML 写法差异假红，也会因重复值丢失计数；`pnpm run X` 与 `pnpm exec X` 的单侧变化会红，`ci-check` 内部顺序调换会绿。当前实现锁的是精确字符串集合，不是唯一的语义步骤身份。

### 3. 终态判定前的不可逆动作和部署副作用

结论：`ci-check` 是 `&&` 链，中途失败不会回滚已完成的本地步骤。`test:coverage` 会写入被 `.gitignore` 忽略的 `coverage/`；`build:dist` 由 `tsdown.config.ts:3-8` 的 `clean: true` 清理/生成 `dist/`，再由 `scripts/build-overlay.ts:5-9` 写入四个 bundle；Playwright 会创建被忽略的报告/结果目录，并由 `tests/playwright/fixtures.ts:14-20` 和 `isolated-serve.ts:125-154` 在正常失败路径停止隔离 server、删除临时 `HOME`/`TMPDIR`。若 runner 被硬杀，子进程或临时目录可能残留，但这些不是用户数据或发布产物的不可逆写入。

逐个读 `test:deploy` 的三个脚本后，未发现真实 systemd 副作用：

- `tests/deploy/test-debug-unit.sh:10-17` 只对 unit 和 `install-debug.sh` 做 `grep`。
- `tests/deploy/test-prod-unit.sh:24-46` 在 `mktemp` 下写假的 `git`/`pnpm`，通过 `PATH` 注入后只观测 `serve-prod.sh` 的参数；不执行真正的 package manager 或 systemd 命令。
- `tests/deploy/test-check-exposure.sh:11-70` 只启动 `127.0.0.1` 随机端口的 Python 假服务，退出 trap 会 kill 并删除临时目录。

`scripts/install-debug.sh`、`scripts/install-prod.sh`、`scripts/update-prod.sh` 中的安装、daemon-reload、enable、start、restart 仅作为被测文本被读取，`test:deploy` 不调用它们，也不写 `~/.local`。因此本问无 P1；需要接受的只是普通 CI/本地运行的可回收临时副作用和异常硬杀下的残留风险。

### 4. 白名单的约束力

结论：白名单不是模式匹配逃逸口，但它的分类正确性依赖维护者。只把一条新命令加进 `CI_CHECK_ENV_PREP_ALLOWLIST` 而不同时更新 `:108-118` 的长度和精确数组断言，会在测试 `allowlist is the four hardcoded env-prep commands with reasons` 处红；只改白名单而保留该命令在 `ci-check` 中，还会在 `:141-147` 处红。若有人有意同时修改白名单、四项期望值并从 `ci-check` 移除该命令，测试会把它当成环境准备而放过；这是对测试契约本身的协同修改，不是当前硬编码实现的静默模式匹配。按锁定决策接受该显式维护点，本轮不另列 finding。

### 5. 层二 skip 的诚实性和层一覆盖

结论：层二 skip 是可见且不冒充通过。`tests/deploy-unit-contract.test.ts:98-102` 先 `console.info` 包含路径和 `layer-2 skipped` 的原因，再调用 Vitest 的 `ctx.skip(reason)`；因此 CI 输出会标出 skipped，不能把缺失 `.omo` 配置误报为成功校验。层一的两个 `parseCliArgs` 测试在 `:61-80` 无任何 CI 条件或 skip，且 `pnpm run test:coverage` 通过 `vitest.config.ts:19-22` 收集 `tests/**/*.test.ts`，所以 CI 仍会跑层一。层二配置存在时才继续 `loadResolvedTargetMode` 并调用 guard；配置缺失的 CI skip 是任务卡明确允许的行为。

### 6. `assertServeCommandCompatible` 抽取的等价性

结论：等价。被审 head 的 `cli.ts:283-285` 仍先 `await loadConfig(configPath)`，随后调用从旧位置原样搬出的条件逻辑；比较条件和错误文本在 `src/cli/args.ts:176-184` 未改变，没有前移到配置加载前，也没有改变 default target 查找、single 模式 trailing command 覆盖或 `serve` 调用。新增的是 `import type { TargetMode }`，只用于类型，不产生运行时副作用。四格测试覆盖单/显式模式与空/非空 trailing argv；本轮未运行被审分支测试，以上为源码等价性结论。

### 7. `test-debug-unit.sh` 修正的正确性

结论：期望字符串与当前 `systemd/herdweb-debug.service:12` 的真实 `ExecStart` 前缀逐字一致，且仍保留工作目录、PATH、端口、loopback、无 `[Install]`、不使用 `serve-prod.sh` 和 installer 不 enable/start 等约束；不是放宽到任意内容。问题仅在于 `grep -F` 未锚定行尾，详见上方 P2：它验证了当前前缀，但没有验证尾部没有重新出现 trailing command。

## 审查边界与证据

- 已读取固定审查范围 `4b9aa5b8562d241cb6079a4a7fb3306d16eafd4d..98b286e35d523f4eed497d76f834b4fded6ef396`，未 checkout 被审分支。
- 已执行 `git diff --check`；未运行被审分支测试，未运行 `tests/deploy/*.sh`、任何 `install-*.sh`，未执行任何 systemd 写操作。
- OCR 前置扫描返回 `status=reviewed`、`profile=minimax`、`model=MiniMax-M3`；其自动复核针对基线工作树的若干“前提不符”标注已按固定 head 源码重新核实，未直接作为 finding。
