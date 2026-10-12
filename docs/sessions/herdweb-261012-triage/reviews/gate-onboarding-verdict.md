<!-- delegate-outcome: succeeded -->

failure-visibility: p1-found

## 冻结范围与结论

审查对象固定为 `1e6619837fa42b1b76ce87049172201fab215ef1..fd4a03b90ea774782727630aa17681e24fbde06d`，risk-tier `personal`。只读了这两个提交中的实现/契约/设计；没有把 PR #212 远端设计 head `8dc8a7c6c6c7cb433abfe5e4010d39e665cdff10` 当实现，也没有读取实现报告。

本次引入发现 **1 个 P1、3 个 P2**。P1 阻断交付：新增视觉 workflow 把任意 pull_request 代码放到可接收公开仓任务的 self-hosted runner 上，随后同 job 再注入 reporter secret。P2 分别影响视觉报告配置、上传失败时的评论准确性、以及上传 producer 的持久契约测试。H0 的本地契约窄测通过；没有真实 GitHub workflow/PWRS 执行，不能据此宣布端到端完成。

## Findings

### F1 — P1，阻断交付：视觉 workflow 将不可信 PR 代码派到公开可用的 self-hosted runner

- **违反**：spec 2、8；外部 fork、Dependabot 和其他不可信 PR 代码不得跑在带 secrets 的 self-hosted 边界上，不能把仓库审批当作隔离。
- **触发路径**：仓库当前为 public；实际 Actions runner group `ci` 的配置是 `visibility=all`、`allows_public_repositories=true`、`restricted_to_workflows=false`。虽然查询时 open fork PR 数为 0，但公开仓可以收到 fork PR，且该 runner group 接受公开仓任务。
- **代码**：`.github/workflows/herdweb-visual.yml:11-18,32,40,46-57,155-179`。`pull_request` 对代码变更触发；job 固定 `runs-on: [self-hosted, ci]`，checkout 后执行 PR 的依赖安装和 Playwright 测试。`PWRS_REPORTER_TOKEN` 虽只在上传步骤注入，但攻击代码与上传步骤处在同一 runner/job，step 顺序不是隔离边界。
- **边界对照**：当前 `gate.yml` 调用的共享 `gate-v2.yml@v2` 在审查时解析到 `f4213194f162062bc22d57cd6ac5589e97d920af`；该 workflow 的 `quality` runner 表达式（第 484 行）会把 fork/Dependabot 路由到 hosted。新增的本地视觉 workflow 没有复用这条准入判断，直接绕过了它。
- **裁决**：P1；**阻断交付**。触发目前尚未观测到，但真实仓库公开状态与 runner group 配置已确认，下一条外部 PR 即可触发。

### F2 — P2，阻断视觉证据验收：HTML 报告目录落在 Playwright 测试产物目录内

- **违反**：spec 4、5，报告目录、HTML 根 index 和媒体必须形成可消费产物。
- **触发路径**：执行 `playwright test --config=playwright.visual.config.ts`。
- **代码**：`playwright.visual.config.ts:27-30` 将 HTML reporter 输出写到 `test-results/playwright-report`，而继承的 Playwright 默认测试产物目录是 `test-results`。
- **实测**：Playwright 实际输出 `Configuration Error: HTML reporter output folder clashes with the tests output folder`，并警告清理 reporter 目录会导致 artifact loss。报告仍生成了 529,808 字节的 `index.html`；这次本地 `serve` fixture 两条 case 均在 30 秒 setup 超时，未生成 PNG 截图，因此没有可视检查的页面截图。
- **裁决**：P2；阻断“视觉报告配置无告警且媒体可验收”，不阻断独立的 `gate / gate` 主 gate。报告路径虽与上传路径相同，配置冲突仍需处理。

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
| 2. fork/Dependabot 安全边界 | **F1 P1** | 当前共享 callee 有分流；本地视觉 workflow 没有，runner group 实测允许 public repo。 |
| 3. quality entry、fail-fast、CI 原质量不丢 | 通过 | `scripts/gate-quality` 是可执行 `#!/bin/sh` + `exec pnpm run ci-check`；契约测用假 pnpm 实测 argv/退出码；`ci.yml` 未改。 |
| 4. 视觉配置、case、ignore、browser | 部分通过/F2 | 实际 discovery 显示 2 tests、1 worker；config reporter 目录冲突。两条 case 在本地 `serve` setup 超时，未能确认交互断言和截图。 |
| 5. report→argv→PWRS→PR 评论 | **F2/F3** | 本地报告 index 和 argv 探针有结果；未跑真实 PWRS/Action；上传状态没有绑定到评论状态。 |
| 6. secret 与真实 producer fixture | 部分通过/F4 | 空 token 实际 fail-loud 且不打印 secret；视觉 workflow 模板没有真实 fixture/hash。 |
| 7. 录屏豁免、变更边界与新增机制 | 通过/保留未知 | AGENTS 保留豁免；未改业务 src、ci.yml、依赖；DNS/hosts 逻辑只有视觉 workflow 一个本地消费者，服务于 tailnet PWRS 访问。其模板来源在 H0 注释中声明，但本仓没有 fixture/hash 可独立比对，归入 F4 的来源缺口，不另报抽象 finding。 |
| 8. YAML/name/permissions/runs-on 与测试分支 | **F1/F4** | caller YAML 与 dispositions 有结构化断言；安全边界缺本地视觉 runner 保护，视觉上传只断源码字符串。 |

## 验证与边界

- H0 窄测：scratch worktree、只读复用既有 `node_modules`，直调 `./node_modules/.bin/vitest run tests/gate-onboarding.test.ts`，50/50 通过。该进程另输出一次 `ECONNREFUSED ::1/127.0.0.1:3000` 未处理错误但 Vitest 仍 exit 0；未能归属到此窄测代码，不计为本次 finding。
- 反向注入：在 H0 scratch 仅把 `gate-disposition.yml` 的 `finding_id` 实际转发值改成 `intentionally-broken`，确认注入后窄测 1 failed/49 passed，且失败为 `AssertionError`；随后还原，scratch 自动清理。
- base 负向拷贝：仅拷测试和真实 fixture 后，Vitest 收集阶段因 `../playwright.visual.config` 不存在而 `Error: Failed to resolve import`。这不是断言红，未把它计作有效反向红验。
- 视觉真实浏览器命令发现 2 case、1 worker，但本地 `serve` setup 超时，未产生 PNG；`ttyd` 当前 shell 不在 PATH，实际超时的根因仍未知。没有截图可供视觉检查，不把失败归因到 CI。
- 实际 upload shell 使用假 `npx` 探针检查 argv、空 token 和非零退出传播；没有向真实 PWRS 上传，也没有调用 PR 评论 action。
- 未运行完整 Vitest、`ci-check` 或 GitHub workflow；因此不下完整 CI 继承红/新红结论。`ocr-review` 不在本机 PATH，前置扫描状态为 skipped（工具缺失），不是 clean。
- `gh pr view` 显示 #212 仍是 draft，远端 head `8dc8a7c6c6c7cb433abfe5e4010d39e665cdff10`；按冻结规则没有读取其实现内容或引用其 CI。

## 踩到的坑

静态配置对象断言没有运行 Playwright CLI，因此漏掉 reporter/test-results 目录冲突。静态检查 upload shell 的字符串也不能替代捕获 producer argv；本轮探针验证了当前 argv，但没有在提交测试中留下同样的边界锁。

## 闸与绕过

共享 gate v2 的真实当前 callee 对 fork 与 Dependabot 有 hosted 分流；本地视觉 workflow 独立启动并直接选 self-hosted runner，因此绕过共享分流。当前 runner group 实际对公开仓开放，不是仅靠注释推断。

## 与卡面的偏差

H0 新增视觉流程尚未在 GitHub runner / PWRS 上运行；本地视觉服务启动失败且没有页面截图。上传参数本地探针和空 token 失败路径已验证，但不等于真实上传与评论闭环。OCR 前置扫描因 `ocr-review` 缺失而 skipped。base 的拷贝测试报 import error，不作为断言红验。

## 最贵的一步

最耗时且最关键的是在 scratch 中启动实际 Playwright 两 case：它暴露了 reporter 目录的真实 Playwright 配置错误，但本地服务无法 ready，未能完成画面/媒体验证。其次是核对 GitHub 当前 runner group 配置与共享 gate v2 的真实 tag 版本，确认本地视觉 workflow 没有继承共享安全分流。
