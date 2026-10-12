<!-- delegate-outcome: succeeded -->

failure-visibility: p2-only

## 冻结范围与结论

审查对象固定为 `1e6619837fa42b1b76ce87049172201fab215ef1..fd4a03b90ea774782727630aa17681e24fbde06d`，risk-tier `personal`。只读了这两个提交中的实现/契约/设计；没有把 PR #212 远端设计 head `8dc8a7c6c6c7cb433abfe5e4010d39e665cdff10` 当实现，也没有读取实现报告。

本次引入发现 **0 个 P1、4 个 P2**。F1 的代码级安全契约仍未满足，但实际仓库审批策略为 `all_external_contributors`，且外部 fork 按当前维护策略不批准；“下一 fork 即可触发”不成立，因此严重度降为 P2。严格 spec 2 验收仍阻断，审批策略不代替代码级 runner 准入。另有 P2 影响视觉报告配置、上传失败时的评论准确性、以及上传 producer 的持久契约测试。H0 visual 两条 case 在真实 ttyd 下通过，但 Playwright 仍打印 reporter 目录冲突诊断；没有真实 GitHub workflow/PWRS 执行，不能据此宣布端到端完成。

## Findings

### F1 — P2，阻断 spec 2 验收：视觉 workflow 将未做代码级准入的 PR 代码派到 self-hosted runner

- **违反**：spec 2、8；外部 fork、Dependabot 和其他不可信 PR 代码不得跑在带 secrets 的 self-hosted 边界上，不能把仓库审批当作隔离。
- **触发路径**：仓库当前为 public；实际 Actions runner group `ci` 的配置是 `visibility=all`、`allows_public_repositories=true`、`restricted_to_workflows=false`。本轮真实 GET `repos/zlxlabs/herdweb/actions/permissions/fork-pr-contributor-approval` 得到 `approval_policy=all_external_contributors`；外部 fork 按当前维护策略不批准，故没有证据支持“下一 fork 即可运行”。fork 默认没有 repo secrets；若被批准，代码仍会进入可访问宿主的 self-hosted runner。
- **代码**：`.github/workflows/herdweb-visual.yml:11-18,32,40,46-57,155-179`。`pull_request` 对代码变更触发；job 固定 `runs-on: [self-hosted, ci]`，checkout 后执行 PR 的依赖安装和 Playwright 测试。`PWRS_REPORTER_TOKEN` 虽只在上传步骤注入，但攻击代码与上传步骤处在同一 runner/job，step 顺序不是隔离边界。
- **边界对照**：当前 `gate.yml` 调用的共享 `gate-v2.yml@v2` 在审查时解析到 `f4213194f162062bc22d57cd6ac5589e97d920af`；该 workflow 的 `quality` runner 表达式会把 fork/Dependabot 路由到 hosted。新增的本地视觉 workflow 没有复用这条准入判断，直接指定 self-hosted。
- **严重度 / 阻断**：本仓判定 **P2**（真实维护路径不会批准外部 fork，没有已观测触发；不为了保 P1 构造获批恶意 job）。**交付阻断：是，仅因 spec 2 的代码级安全契约尚未满足**；当前审批策略是流程性缓解，不能作为该契约的实现证据。工具原标注 P1；本仓两问：当前路径是否触发？未触发；若审批策略改变或获批，宿主后果不可接受。

### F2 — P2，不阻断本地 visual case：HTML reporter 输出目录嵌套在 Playwright 测试产物目录内

- **违反**：spec 4、5，报告目录、HTML 根 index 和媒体必须形成可消费产物。
- **触发路径**：执行 `playwright test --config=playwright.visual.config.ts`。
- **代码**：`playwright.visual.config.ts:27-30` 将 HTML reporter 输出写到 `test-results/playwright-report`，而继承的 Playwright 默认测试产物目录是 `test-results`。
- **实测**：在 H0 scratch 将 `TMPDIR` 设置为系统临时目录，使用 mise 中真实 ttyd `1.7.7-40e79c7` 并把只读既有 `node_modules/.bin` 加到 PATH，完整 visual 配置发现并通过 2/2 case，命令 exit 0。Playwright 输出 `Configuration Error: HTML reporter output folder clashes with the tests output folder` 和清理目录可能造成 artifact loss 的提示；本次没有硬失败，测试后实际留下两张 PNG，均已查看，未观察到 PNG 丢失。
- **裁决**：P2；不阻断本地两条 visual case 或主 gate。目录冲突诊断仍违反 spec 4/5 的报告与媒体隔离要求；本轮不把诊断文字当成进程硬失败，也不以此前 `serve` setup timeout 证明目录冲突导致测试红。

### F3 — P2，不阻断主 gate：上传失败后评论仍可能带成功 e2e 状态和空证据链接

- **违反**：spec 5 的“失败不装成功”及 producer→PWRS→PR 评论链路。
- **触发路径**：视觉用例成功，随后 token 缺失/无效或 reporter CLI 上传失败。上传和发布步骤都用 `if: !cancelled()`；发布步骤仍执行，并只传 `steps.e2e.outcome`。
- **代码**：`.github/workflows/herdweb-visual.yml:155-181`；上传步骤没有被发布步骤引用其 `outcome`。审查时读取到的 `ui-evidence-publish@main`（main 当时为 `d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4`）只接收 `e2e-status`，评论正文也按该值显示通过/失败并生成报告搜索链接；没有上传结果输入。
- **裁决**：P2；不阻断主 gate 合并，因为 Actions job 仍会显示上传失败；但 PR 评论可能显示 e2e 通过并给出实际上无报告可命中的链接，违背证据链不报成功的要求。

### F4 — P2，不阻断当前运行：视觉上传契约只做源码字面量检查，缺少真实 producer fixture/argv 回归锁

- **违反**：spec 5、6、8 的跨进程 producer payload、真实来源与 hash、真实分支覆盖要求。
- **代码**：`tests/gate-onboarding.test.ts:410-418` 只用 `run.toContain(...)` 检查 YAML shell 文本；`tests/fixtures/gate-onboarding/SOURCE.md` 没有登记 H0 注释引用的 `gate-hub/templates/ui-visual/workflow.yml`，也没有该模板的 fixture/hash。相同测试文件对 caller/quality fixture 有真实来源与 SHA，这一覆盖只缺视觉 producer。
- **实测边界**：本次在 H0 scratch 中从实际 YAML 解析 upload `run` 块、用假 `npx` 接收 argv：report 目录、URL、项目、完整 head SHA title 和 meta 参数均按预期形成；假 uploader 返回 17 时 shell 返回 17。空 token 路径实际返回 1、输出 `HERDWEB_UI_REPORTER_TOKEN_MISSING`，且未调用假 `npx`。这些是本轮探针证据，不是仓内回归测试；PR 评论也没有真实 PWRS 返回绑定测试。
- **裁决**：P2；不阻断当前上传脚本的已测行为，但阻断该跨边界契约被当前仓测试持续锁定。

## 不变式 → 代码 → 测试对应

| Spec | 审查结果 | 证据/测试 |
|---|---|---|
| 1. 三个 caller、tier/runner/has_ui、disposition 八项直转发、shadow 独立 | 通过 | `gate.yml`、`gate-shadow.yml`、`gate-disposition.yml`；H0 `tests/gate-onboarding.test.ts` 50/50 通过。八项空串可传的行为由原样表达式覆盖。 |
| 2. fork/Dependabot 安全边界 | **F1 P2，阻断 spec 2 验收** | approval policy 要求外部贡献者审批，实际维护策略不批准 fork；因此无当前触发证据。视觉 workflow 仍缺代码级 runner 准入，不能用审批流程代替安全契约。 |
| 3. quality entry、fail-fast、CI 原质量不丢 | 通过 | `scripts/gate-quality` 是可执行 `#!/bin/sh` + `exec pnpm run ci-check`；契约测用假 pnpm 实测 argv/退出码；`ci.yml` 未改。 |
| 4. 视觉配置、case、ignore、browser | 部分通过/F2 | H0 实际运行 2 tests、1 worker、2/2 通过，PNG 可查看；仍有 reporter/test-results 目录冲突诊断。 |
| 5. report→argv→PWRS→PR 评论 | **F2/F3** | 本地报告 index 和 argv 探针有结果；未跑真实 PWRS/Action；上传状态没有绑定到评论状态。 |
| 6. secret 与真实 producer fixture | 部分通过/F4 | 空 token 实际 fail-loud 且不打印 secret；视觉 workflow 模板没有真实 fixture/hash。 |
| 7. 录屏豁免、变更边界与新增机制 | 通过/保留未知 | AGENTS 保留豁免；未改业务 src、ci.yml、依赖；DNS/hosts 逻辑只有视觉 workflow 一个本地消费者，服务于 tailnet PWRS 访问。其模板来源在 H0 注释中声明，但本仓没有 fixture/hash 可独立比对，归入 F4 的来源缺口，不另报抽象 finding。 |
| 8. YAML/name/permissions/runs-on 与测试分支 | **F1/F4** | caller YAML 与 dispositions 有结构化断言；安全边界缺本地视觉 runner 保护，视觉上传只断源码字符串。 |

## 验证与边界

- H0 窄测：scratch worktree、只读复用既有 `node_modules`，直调 `./node_modules/.bin/vitest run tests/gate-onboarding.test.ts`，50/50 通过。该进程另输出一次 `ECONNREFUSED ::1/127.0.0.1:3000` 未处理错误但 Vitest 仍 exit 0；未能归属到此窄测代码，不计为本次 finding。
- 反向注入：在 H0 scratch 仅把 `gate-disposition.yml` 的 `finding_id` 实际转发值改成 `intentionally-broken`，确认注入后窄测 1 failed/49 passed，且失败为 `AssertionError`；随后还原，scratch 自动清理。
- base 负向拷贝：仅拷测试和真实 fixture 后，Vitest 收集阶段因 `../playwright.visual.config` 不存在而 `Error: Failed to resolve import`。这不是断言红，未把它计作有效反向红验。
- 完整 Vitest 对照：base 84 files / 1503 tests，H0 85 files / 1553 tests；两边都是相同 18 个失败测试名，失败集合逐行 diff 为空。失败为 scratch 直接调用 Vitest 时子进程 `spawn tsx ENOENT`（scratch 命令没有把 `node_modules/.bin` 放入 PATH），不是 H0 新红，也不是 `ps` 的 `ENOBUFS`。两种真实 `ps` argv 仅记录字节：base 起跑 902342/894105、失败 966261/960744；H0 起跑 966384/960830、失败 964772/960166，均低于 1 MiB。该 PATH 限制使这次完整套件没有得到全绿结论。
- visual 浏览器运行：固定 H0 的 scratch 将 `TMPDIR` 设为系统临时目录，使用 mise 管理的真实 ttyd 和 Chromium 跑 visual 两 case；2/2 passed、exit 0。截图已复制到仓外并查看：`1e7cc7f1b1e97e614335912ca4af3db8ea89fedc.png` 为终端页，`f280bda1ab08a0bf4778d8494d6add9e2596cbcc.png` 为命令回显及抽屉状态。
- 实际 upload shell 使用假 `npx` 探针检查 argv、空 token 和非零退出传播；没有向真实 PWRS 上传，也没有调用 PR 评论 action。
- 通过本机已存在的绝对路径 `ocr-review` 包装器运行，envelope 为 `status=reviewed, reason=primary_selected`，7 条候选均做了独立处置；不把 OCR severity 直接当本仓严重度。未运行 `ci-check` 或 GitHub workflow；因此完整 CI 继承红/新红仍未能判定。
- `gh pr view` 显示 #212 仍是 draft，远端 head `8dc8a7c6c6c7cb433abfe5e4010d39e665cdff10`；按冻结规则没有读取其实现内容或引用其 CI。

## 本轮补证摘要（原始文件在仓外）

- approval policy JSON：`9e1d311f9e8df080b0bbe40f03f338e85b91fc7fdc74c703927ef237fdda4528`
- 固定 base..H0 diff：`5cb5c1d1be6d027c7d53a20bbd9bead0a3d9a8558f02c8a3cd315c200306b40f`
- OCR stdout / stderr：`3cf4d6c61635583a2777aa961e6852c60faf8756df1f1fc239f67c4c0c8b156b` / `42a45ce9e85d3bd031f2fef81be9a2808f945334cc9fe576186c773b6ba4984d`
- 完整 Vitest base/H0：`2760fb11868525efcd3217e45f06adee94a70c3e01d50cb34715bd2a29719189` / `f75cff7fe3e2bb4d3a6133d13c93778878deefbcb2afea4b0d30719f54f86dc4`；ps/退出状态：`57dea12ed0b4b7b5314450cb6563b89ef30d95313bdb90d04230fc015aaec439` / `526e93c9dd1b975b2ba2b44ae5b0a5a81b418284ac1545913186105c726df654`。
- 相同失败集合清单 SHA-256：`725d4f4157a8c8465c79f1c11c7128fbff8692e1bff7bb05905c0472480c450c`。
- mise 实际版本记录 / OCR 短 spec：`5b1b191eae5b8524e2232392d4f068e8d4d178ad23b268757ac78def4cce9aca` / `857a8bc41268baf29c68809985f177b003fa015f1606a3ddb33df022aa079c75`。
- visual driver / Playwright：`c9ee8fd3e8ff3d16070c94028798e4d8ee198166dd959109cec3de82d9eeecd7` / `dbe35e80ccbbb4cf1118faa0a1ddf9250887772b87c5dc1efcfe1ab182e55c9f`；两 PNG：`a976169f7cdd56ebfad0cd1915392c7619eef030a72b8c8e05d67b0cf7eb3e91` / `f4f141c8b73cef3ba4ae40a2adf81daa03c47c598778c9aa7afccbe6aaad906a`。
- 固定 disposition callee：`7e631e4f15301d56b8c87dcc2810371128951945bf14ab8a54df0b26ecbb05a2`（只引用 SILO secrets）。派发报告列明每项对应的仓外文件路径与 SHA-256。

## OCR 候选独立处置

OCR 7 条中没有新增 P1。`gate.yml` 的 fork/self-hosted 候选被 OCR 自己标为 unverified；本轮固定 callee `f4213194f162062bc22d57cd6ac5589e97d920af` 的已核证行为是把 fork/Dependabot 路由到 hosted，故不采纳为 gate.yml 新 finding，也不改变视觉 workflow 的 F1。`gate-disposition.yml` 的 `secrets: inherit` 确实会传递调用方全部 secrets（[GitHub reusable workflows 文档](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows?learn=getting_started)）；它与真实 `gate-hub` caller fixture 字节一致，触发是手动 `workflow_dispatch`，固定 callee 仅引用 SILO 密钥。spec 未要求该 caller 改用 allow-list，故作为非阻断最小权限风险记录，不新增本轮 finding。其余候选：`@v2` 是 spec 1 指定的共享契约；timeout/concurrency 没有对应 spec 或资源耗尽证据；quality artifact 上传结论缺真实消费步骤，均不采纳。OCR 原始结果及摘要 hash 已保留。

## 踩到的坑

静态配置对象断言没有运行 Playwright CLI，因此漏掉 reporter/test-results 目录冲突；真实命令确认这是 exit 0 的配置诊断而非本轮硬失败。完整 Vitest 的直接二进制运行还需要把只读 `node_modules/.bin` 放入 PATH，当前两树对照因此同样出现 `spawn tsx ENOENT`。接手简报脚本本身在第 187 行报 Python `SyntaxError`，未能取得巡检节；没有因此读取其它 worktree 报告。

## 闸与绕过

共享 gate v2 的真实当前 callee 对 fork 与 Dependabot 有 hosted 分流；本地视觉 workflow 独立启动并直接选 self-hosted runner，因此绕过共享分流。当前 runner group 实际对公开仓开放，不是仅靠注释推断。

## 与卡面的偏差

H0 新增视觉流程尚未在 GitHub runner / PWRS 上运行；本地 visual 两 case 已在真实 ttyd 下通过并查看了 PNG，但 reporter 目录冲突提示仍在。上传参数本地探针和空 token 失败路径已验证，不等于真实上传与评论闭环。base 的拷贝测试报 import error，不作为断言红验。完整 Vitest 两边同失败集合，但本次入口 PATH 缺少 `tsx`，不作为完整 CI 结论。

## 最贵的一步

最耗时的是 base 与 H0 串行运行完整 Vitest 各一次，用同一失败集合和失败时 `ps` 实际字节数区分环境问题与 H0 新红。最关键的新证据是实际 approval policy 将原 F1 从 P1 调为 P2，并通过真实 ttyd 跑通 visual 两 case，确认 reporter 冲突打印错误字样但不使本次命令失败。
