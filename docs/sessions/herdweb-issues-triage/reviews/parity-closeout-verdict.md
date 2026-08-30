FAIL

# CI parity 收口终审 verdict

- 被审 head：`e1010e06afa82b3533f4799cbfb41672eb06efd2`
- 上一轮 head：`b4bb8e2fe73d3d8e1d6676de8927749409f243d1`
- 审查时间：2026-08-30T22:23:23+08:00（Asia/Shanghai）
- 本轮是否有新增 P1：有，3 条；因此本轮不能计入“无新增 P1”收敛轮。
- 审查范围：本轮收口增量 `b4bb8e2..e1010e0`，以读代码和推理为主；未运行被审分支测试。

## Findings

### P1-1：触发器不在守卫范围内

- 位置：`tests/ci-entry-parity.test.ts:102-107,198-203`；被读取的 workflow 触发器在 `.github/workflows/ci.yml:3-7`。
- 缺陷：`checkJobSteps()` 只取 `jobs.check.steps`，没有任何断言证明该 workflow 会在 pull request 上触发。这个测试本身又只能在 check job 已经启动后执行，不能自举保护 `on:`。
- 触发场景：把 `on.pull_request.branches` 改成不会匹配 `main` 的分支，或删除 `pull_request` 事件。PR 上不再执行 check job，也就不会执行 parity 测试；若没有已证实的 required status check，PR 可以带着未执行的验证进入合并流程。
- 严重度判定：P1。真实 PR 使用路径会触发该缺陷，后果是验证守卫静默缺席且可能无人发现，属于 internal 档的静默出错。GitHub 官方说明分支过滤会阻止 workflow 运行，只有配置为 required 的关联检查才保证阻止合并：[Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。
- 建议方向：把“PR 必须触发 CI”的契约放到不会随该 workflow 一起失效的外部/分支保护门禁，或由独立、不可被本 workflow 自身跳过的检查验证触发器；不能只在这份 parity 测试中追加 `on:` 断言。

### P1-2：失败策略和运行上下文可绕过唯一入口

- 位置：`tests/ci-entry-parity.test.ts:96-107,132-149,198-203`。
- 缺陷：结构模型只保留 `uses`、`run`、`if`；分类器只验证唯一入口的 `if` 未出现，没有约束 job 的 `if`/`continue-on-error`/`defaults.run`，也没有约束入口 step 的 `continue-on-error`/`shell`/`working-directory` 等会改变结果的字段。
- 触发场景：
  - 在 `jobs.check` 加 `if: false`，所有 steps 被跳过，结构测试即使被另一个路径运行也仍只看到合法 steps；在没有 required check 的实际合并路径中没有验证结果。
  - 加 `continue-on-error: true`，`pnpm run ci-check` 失败后 job/workflow 仍可被报告为通过。GitHub 文档明确说明该字段允许 workflow 在该 job 失败时通过：[continue-on-error](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。
  - 加 `defaults.run.shell: bash {0} || true`，GitHub 支持这种 `{0}` 自定义 shell 模板；脚本失败后由末尾 `true` 返回 0，唯一入口实际失效但 `steps` 形状完全不变：[custom shell](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。同样的漏洞可直接放在唯一入口 step 的 `continue-on-error` 或 `shell` 上。
- 严重度判定：P1。上述第二、第三个场景直接把真实失败变成成功，是 internal 档的静默出错；第一个场景使 job 根本不执行，和触发器缺陷同属 fail-open。
- 建议方向：把 job 与入口 step 的执行控制字段纳入一个显式、最小的允许形态并对未知/非默认值 fail closed，至少锁定 job/step `if`、`continue-on-error`、`shell` 和工作目录；不要只把字段类型加进 TypeScript 接口而不做断言。

### P1-3：允许的 checkout action 输入未锁定

- 位置：`tests/ci-entry-parity.test.ts:53-62,127-135`。
- 缺陷：`CI_CHECK_ENV_PREP_USES` 只比较 `uses` 字符串，允许 `actions/checkout@v4` 携带任意 `with`。action 的 `ref`、`repository`、`path` 会改变后续 run steps 实际使用的工作区，而分类器完全看不见这些输入。
- 触发场景：将现有 checkout 改为：

  ```yaml
  - uses: actions/checkout@v4
    with:
      repository: zlxlabs/herdweb
      ref: b4bb8e2
  ```

  workflow 仍使用当前 head 的 step 结构，但后续 `pnpm install` 和 `pnpm run ci-check` 在旧工作树中执行，当前 head 的收口守卫和配置没有被验证。也可以指定一个含有同名、弱检查 `ci-check` 的公开仓库。官方文档确认 checkout 默认取触发 ref，并支持用输入改变 ref/repository：[actions/checkout](https://github.com/actions/checkout)。
- 严重度判定：P1。真实 CI 会执行，且 parity 测试会对被 checkout 的另一份文件给出成功结果；当前 PR 的验证结果被静默替换，后果不可接受。
- 建议方向：锁定 checkout 的 `repository`、`ref`、`path`、凭据相关输入为当前 workflow 需要的唯一形态，或让独立守卫读取并校验 workflow 实际运行的 commit，而不是只允许 action 名称。

## 重点 1–4

### 1. `on:` 作用域

结论：P1，见 P1-1。它不是“parity 仍然绿”的普通边界，而是整个守卫可被触发器关闭；当前仓库没有证据证明 required status check 会兜底。GitHub 的分支过滤语义是 workflow 不运行，关联检查可能保持 Pending；“可能显示 Pending”不能替代本仓已配置的合并阻断保证。

### 2. job 级执行面

结论：P1，见 P1-2 和 P1-3。

- `container` 会改变所有 run steps 的文件系统和默认 shell；`services` 只启动服务容器，当前步骤没有引用它时不会凭空替代验证命令；二者都不是当前 workflow 的直接 false-green 证据，但必须作为未锁定运行上下文处理。GitHub 对 container/service 的作用域说明见 [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。
- `defaults.run.shell` 能通过自定义 shell 模板吞掉退出码，是确定的 P1；`defaults.run.working-directory` 能把命令指向另一工作目录，当前仓库虽通常会因找不到 manifest 失败，但不能作为守卫的隐含安全保证。
- `strategy.matrix` 本身只是复制每个组合执行 steps，`fail-fast` 取消其它组合不是成功；但 job `if` 在 matrix 展开前求值，或与 `continue-on-error: ${{ matrix.experimental }}` 组合时，可产生跳过/被接受的失败，落入 P1-2。官方语义见 [job if / matrix / continue-on-error](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。
- `env` 会注入所有 job steps，能改变 `pnpm`、Node 与测试的运行环境；本轮没有从项目脚本证明某个单独 env 键必然 false-green，因此列为需纳入允许形态的执行上下文，不另报一条 P1。
- job `permissions`、`timeout-minutes`、普通 `strategy.fail-fast`、`services` 在当前命令链中只会限制/改变资源或失败传播，未找到单独的 false-green 场景；`needs`/job skip 仍回到 job `if`/required-check 问题。

### 3. `checkJobSteps()` 的失败形态

结论：P2，不是 P1。将 `check` 改名或删除 `steps` 时，`checkJobSteps()` 在测试体内抛出 `Error('CI check job has no steps list')`；Vitest 会把测试体异常记录为失败测试，因而会红，不会造成整个测试文件收集阶段失败，也不会假绿。但 I6 要求违反不变式表现为断言失败，这里仍是显式 helper throw，诊断形态不符合契约。

触发场景：`jobs.check.steps` 缺失或被改成标量；`doc.jobs?.check?.steps` 为 `undefined`/非数组，执行到 `tests/ci-entry-parity.test.ts:105` 即抛错。

建议方向：在测试体中用明确 `expect(Array.isArray(steps), ...)` 断言后再转换，或让 helper 返回可断言的未知值，保留“测试失败”而不是依赖异常冒泡。

### 4. `stepCommands()` 的按行边界

结论：P3，属于已知且可接受的精确形态边界，不是 P1。`tests/ci-entry-parity.test.ts:109-115` 会把反斜杠续行拆成两条，故合法的 `pnpm run ci-check \\` + 下一行参数会假红；单行的 `&&` 或 `;` 则作为整串，不会误认为唯一入口，因而会落入 `unaccounted` 并红。这是 fail-closed 的结果，不会制造假绿。当前设计明确锁定 `run: pnpm run ci-check` 的单命令形态，建议记录该边界并保持文档同步；只有要支持多行 shell 语义时才需要换解析层。

## 重点 5–7

### 5. `uses:` 白名单

结论：版本号硬编码是有意的显式维护点，不是过度僵硬；把真正执行验证的 action 加进白名单本身也不会绕过当前“唯一一条 `run: pnpm run ci-check`”断言，因为 action 替代该 run step 会使 `entries` 数量变成 0。新 action 若与唯一入口并存，只是增加执行面，不能单独制造 false-green。

但白名单输入未锁定造成的 checkout 逃逸已单列为 P1-3：`uses` 字符串正确不代表 action 的 `with` 形态正确。升级 `actions/checkout@v4` 到 `@v5` 会因 `tests/ci-entry-parity.test.ts:180-183` 的精确数组断言而红，这是让维护者显式审查升级的合理成本；升级不是本轮 finding。

### 6. systemd 归一化与 `lacks()`

结论：未发现新增 P1/P2。`tests/deploy/test-debug-unit.sh:15-19` 的第四个 sed 表达式中 `[^=]*` 不能跨过等号，因此只会匹配第一个等号；例如 `Environment=PATH=/a:/b` 归一化后仍是 `Environment=PATH=/a:/b`，第二个等号及其两侧值内空格不被改写。无等号的行、注释行和 `[Unit]` 等节标题不会匹配第四式，只经过行首/行尾空白和 CRLF 处理；在当前 unit 内容中这不会把非法节或注释变成合法 directive。

`lacks()` 的 `grep -qF ... && fail ...; return 0` 在 `set -e` 下语义正确：无匹配时 AND 列表允许 grep 返回 1，显式 `return 0` 让检查继续；有匹配时 `fail()` 立即退出。`return 0` 是必要的，否则“缺少禁用项”会因函数返回 grep 的 1 而被 `set -e` 误判为脚本失败。负向检查是子串匹配，若未来注释文字包含被禁止 token 会假红而不会假绿，属于可接受的保守边界。

代码确实还用 `s/[[:space:]]*$//` 去掉行尾空白；这比锁定决策列出的三类归一化略宽，但只影响行尾空白，不改值内部空格，也没有在当前 unit 合同上形成放过错误 directive 的路径，故不升级为 finding。

### 7. 全局回归

结论：从本轮 diff 的静态对照未发现 I3、env-prep 白名单或 `ci-check` 组成退化：

- I3 脚本体展开表 `EXPECTED_REFERENCED_SCRIPT_BODIES` 未改变；`pnpm run <name>` 仍逐项和 `package.json` 的脚本体精确比较。
- 四条 env-prep 命令仍由精确数组断言锁定，并由 `checkJobSteps()` 的同一结构化解析结果检查它们存在；新增 action 数组也使用精确比较。
- `EXPECTED_CI_CHECK_COMMANDS`、`parseCiCheckCommands()` 和双向缺失/额外命令断言仍锁定 `ci-check` 组成；`yaml` 是直接 devDependency，lockfile importer 也已登记。
- systemd 改动只在 `test-debug-unit.sh`，没有触及 unit、安装脚本或 `ci-check` 脚本体。

本轮没有复跑被审分支测试；主脑已提供的外部实证为 `pnpm test` 78 files / 1331 tests、TypeScript、Biome、oxlint、knip 均通过，且 `.github/` 与 `systemd/` 相对上一轮无改动。上述 P1 是静态判据对运行语义的覆盖缺口，不会被这些正常路径的绿验推翻。

## OCR 前置扫描处置

本轮 OCR 包装器返回 `status=reviewed`、`coverage=complete`，不是 skipped。外部标注与本仓判定如下：

| OCR 工具标注 | 本仓判定 | 处置 |
|---|---|---|
| “把 9 个步骤合并成一个 `ci-check`，降低可诊断性”（medium） | 无效/事实错误；`e1010e0:.github/workflows/ci.yml:22` 确实是 `pnpm run ci-check`，但该 finding 的验证器误读为旧步骤 | 不纳入 finding |
| `check` 无 `timeout-minutes`（medium） | P2 级维护建议，但不属于 `b4bb8e2..e1010e0` 收口增量，且不造成 false-green | 不阻塞本轮，交主脑 backlog |
| 无 `concurrency`（low） | P3 级资源/重复运行建议，不属于本轮增量 | 不阻塞本轮，交主脑 backlog |

## 最终判定

本轮有新增 P1，且集中在新判据仍未覆盖的 workflow 触发边界、job/step 失败传播和允许 action 的输入语义；因此 verdict 为 `FAIL`。结构化 YAML 解析和唯一入口方向本身有效，未发现需要回退正则或恢复集合比对的理由；但当前实现不能宣称“只要 steps 形状正确，CI 验证就不会被静默绕过”。
