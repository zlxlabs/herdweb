FAIL

# PR #130 第二轮终审 verdict

- 被审 head：`b4bb8e2fe73d3d8e1d6676de8927749409f243d1` (`card/ci-check-entry`)
- 第一轮 head：`98b286e35d523f4eed497d76f834b4fded6ef396`
- 审查时间：2026-08-30（Asia/Shanghai）
- 本轮是否有新增 P1：**是，1 条**。因此本轮不能作为 personal/infrastructure 例外所需的第二个无新增 P1 轮次。
- 审查方法：只读 `98b286e..b4bb8e2` 增量及其必要上下文；未运行被审分支测试。OCR 前置扫描状态为 `reviewed`，其 3 条建议均经代码核对后不成立，未计入 finding。

## Findings

### P1（新增）：YAML 提取器把任意嵌套或条件 `run:` 当成真实步骤

- 位置：`tests/ci-entry-parity.test.ts:120-123`，并由 `extractJobRunCommands` 的整体扫描边界 `:93-132` 触发。
- 缺陷：新增正则 `^\s+(?:-\s+)?run:` 只看键名和缩进，不记录当前节点是否位于 `steps` 列表的步骤层，也不排除 `with:`、其他多层映射或被 `if:` 条件跳过的步骤。
- 触发场景：把实际的 `- run: pnpm run ci-check` 换成一个 `uses:` 步骤，并在其 `with:` 块写 `run: pnpm run ci-check`；或使用 `- name: CI check`、`if: false`、`run: pnpm run ci-check`。提取器仍返回唯一的 `pnpm run ci-check`，随后顶层 parity 只核对 `ci-check` 字符串组成，整套检查可能根本没有执行而测试仍通过。多层嵌套的 `run:` 也有同样风险。
- 影响：守卫对 CI 终态执行覆盖失效，属于本项目定义的“守卫本身失效且无人察觉”，可造成假绿，按 internal 档为 P1。
- 建议方向：让提取只接受 `jobs.<job>.steps` 下实际 step 的 `run` 字段，并显式处理/拒绝条件步骤；至少加入 `with.run`、嵌套 `run`、注释和条件跳过的回归样例。可使用可信 YAML 解析或按已知步骤层级做状态化解析，不能继续用 job 范围内的任意键名扫描。

### P2（新增）：debug unit 断言对 systemd 等价格式做字节级拒绝

- 位置：`tests/deploy/test-debug-unit.sh:8-12`。
- 缺陷：`has()` 改用 `grep -qxF` 后，匹配要求整行原始字节完全一致，不接受换行格式或空白差异，也没有先按 systemd 语法归一化。systemd 语法允许忽略等号两侧空白，因此合法的 `ExecStart =...` 等格式会在 systemd 可接受的情况下被测试拒绝；CRLF、行首空格等格式也会直接导致匹配失败。
- 触发场景：维护者仅把 unit 的 `ExecStart=` 写成 `ExecStart = ...`，或提交工具改写行尾/行首空白；服务语义未改变，但 `test-debug-unit.sh` 报 `debug command contract changed`。
- 影响：新增误红/维护脆弱性，不造成假绿；若项目明确把 unit 的原始字节布局也作为契约则可接受，但本次改动未说明这一额外边界。按 internal 档记 P2，不阻塞本轮 P1 结论。
- 建议方向：保留“命令值必须整行相等”的防护，同时对 systemd 允许的行尾、等号周边空白和换行做受控归一化；或明确记录并测试“字节级 canonical unit”是有意契约。

第一轮遗留 finding：无。本轮不重审第一轮四条已确认修复；上述两条均由本轮增量新引入。

## 本轮七项重点

1. **展开逻辑完整性：无新增 P1。** `pnpm exec tsc --noEmit` 在 `:239-240` 因不匹配 `PNPM_RUN_INVOCATION` 而不进入脚本体展开；这不是整个 parity 的静默忽略：`EXPECTED_CI_CHECK_COMMANDS:45` 与顶层集合比较仍精确锁定该完整命令，改变它会使 parity 失败。它没有 package script 可供解引用，当前处理与锁定边界一致，因此没有假绿路径。
2. **锁定表与真实 scripts：无新增 finding。** 当前 `EXPECTED_REFERENCED_SCRIPT_BODIES:58-69` 有 9 项，对应 `ci-check` 的 9 个 `pnpm run X`；`:241-246` 对每个实际引用检查锁定体和 live script，`:248-254` 检查双向名称集合。只删锁定表而保留引用会在 `expected` 未定义处失败；同时从 `ci-check` 与表中删除会被顶层 `EXPECTED_CI_CHECK_COMMANDS` parity 抓住。没有假绿路径。
3. **YAML 解析边界：有新增 P1，见上。** 当前工作流中的 named-step 形态能被识别，完整行注释 `# - run:` 不会匹配，误识别通常会假红；但 `with.run`、条件跳过的 named-step 和任意深层 `run:` 可被伪装成唯一验证步骤，属于不可接受的假绿。
4. **行锚定断言严格度：有新增 P2，无假绿。** `:8-12` 的 `grep -qxF` 能阻止 ExecStart 追加参数，也继续保护 `WorkingDirectory`、完整 `PATH`、无 `[Install]`、不含 `serve-prod.sh`、不含 `0.0.0.0`、不含生产端口 `7681`；`:17` 的 installer enable/start 禁止检查未变。新增问题是原始字节匹配造成的合法格式误拒，详见 P2 finding。
5. **F4 契约注释：无新增 finding。** `:205-209` 明确写出这是 set equality，接受 `&&` 重排与重复，并说明顺序不是契约、重复不会造成假绿；同时点明 `Array.includes` 是有意实现。读者能据此判断只有顺序/重复成为实际契约时才应升级为有序或计数比较。
6. **style 提交行为中立：无新增 finding。** `b4bb8e2` 只把 `expect(expected, ...).toBeDefined()` 从多行折为一行，参数、匹配对象和断言结果均未改变。
7. **全局回归：未发现第一轮已确认部分的增量退化。** 本轮没有改 `.github/workflows/ci.yml`、`package.json`、`cli.ts`、`src/cli/args.ts` 或 deploy unit；F3 对现有环境准备块仅做等价的单空白归一化，层二 skip 可见性、层一 CI 覆盖、`assertServeCommandCompatible` 抽取等价性和硬编码 allowlist 的约束仍在。需主脑在被审分支实测确认的项目级全量测试结果沿用现场事实，本轮未重复运行。
