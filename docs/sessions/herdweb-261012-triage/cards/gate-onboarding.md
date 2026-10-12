# 任务卡：接入 gate v2 主门禁 + UI 录屏发布（#178 单 PR）

> 草案，供 Pi 主脑审定后派出。Task-Id 留空，由派发分配。

## 目标

在 zlxlabs/herdweb 仓内落三个平台 caller + 一个稳定质量入口 + 一条本仓工具链适配的 UI 走查流水线，
让 **ready（非 draft）PR** 上 `gate / gate` 的 `primary` job 真实执行（job 级 conclusion 为 SUCCESS，
SKIPPED 不算），并让**同一个 PR** 内跑完：真实质量检查 → ready 主审 → 走查 producer artifact →
共享发布 action → 一条可打开、标题含完整 40 位 head SHA 的 `ui-evidence` 报告链接；三条同时成立
后才删除 `AGENTS.md` 的录屏豁免。复用平台 caller/共享 action，不复制平台实现，不新造 CI 流水线。
前置凭据（`SILO_*` 对公开仓不可见、本仓无 `PWRS_REPORTER_TOKEN`，见 triage.md）未开通时接线照做，
primary 与走查发布按显式失败停下上报，不降级验收、不绕过。
- **Evidence-Commands**：
  ```sh
  gh api /orgs/zlxlabs/actions/runner-groups/1 --jq '{visibility,allows_public_repositories,restricted_to_workflows}'
  gh api /orgs/zlxlabs/actions/runner-groups/4 --jq '{visibility,allows_public_repositories,restricted_to_workflows}'
  gh workflow list --repo zlxlabs/herdweb
  gh run list --repo zlxlabs/herdweb --workflow gate.yml --limit 5
  ```

## 非目标

- 不改 gate-hub / gate 仓的任何文件（registry、runner group、共享 action、模板）。
- 不改 `ci.yml` 的 runner 行、不删 `pnpm run ci-check`、不把 `test:pw` 降级为非阻断。
- 不在本卡里改 #147 的行为；不改 `src/` 业务逻辑。
- 不用 dry-run、不能用 draft PR 的绿色、不能用「能列组」当接入完成。

## 基线与所有权

- **Task-Id**：（派发分配，留空）
- **Fixes-Issue**：Refs #178（提交信息禁止写 `Fixes #178` 自动关单）
- **Verify-Mode**：command
- **Verify-Command**：pnpm run ci-check
- **Narrow-Verify**：pnpm exec vitest run tests/gate-onboarding.test.ts && ./node_modules/.bin/playwright test tests/playwright/herdweb-visual.spec.ts --config=playwright.visual.config.ts --workers=1 --retries=0
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：750
- **阶段**：planning
- **锁定决策**：禁止调大 timeout/retries、禁止 skip/continue-on-error 装绿；禁止自动重试门禁；
  接入必须复用平台 caller 与共享 action；不改平台安全策略；凭据缺口只上报不绕过。
- **任务类型**：integration
- **复杂度**：M
- **Base commit**：1e6619837fa42b1b76ce87049172201fab215ef1
- **Depends-On**：无
- **Branch**：chore/261012-gate-onboarding
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：由 delegate 派发决定
- **子代理 fan-out**：0
- **执行器角色声明**：本会话即执行器（implementer），不再委派。
- **提交授权**：授权 commit+push
- **计划者与审查者**：Pi lead

## 修改边界

- **允许**：`.github/workflows/gate.yml`（新）、`.github/workflows/gate-shadow.yml`（新）、
  `.github/workflows/gate-disposition.yml`（新）、`.github/workflows/herdweb-visual.yml`（新）、
  `scripts/gate-quality`（新，可执行）、`tests/gate-onboarding.test.ts`（新，YAML 契约测试）、
  `tests/playwright/herdweb-visual.spec.ts`（新，独立、无人工停顿的走查用例；重置由既有
  `tests/playwright/isolated-serve.ts` 每用例新进程 fixture 保障）、`playwright.visual.config.ts`（新）、
  `AGENTS.md` 的 `ui-evidence-exempt` 行、`docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md`（新）。
- **禁止**：`src/**`、`tests/**`（除上面两条显式例外）、`package.json`、`pnpm-lock.yaml`、
  `playwright.config.ts`、`.github/workflows/ci.yml`、任何其它仓文件；已有历史 session 记录不得改写。
- **Scope-Globs**：.github/workflows/gate.yml .github/workflows/gate-shadow.yml .github/workflows/gate-disposition.yml .github/workflows/herdweb-visual.yml scripts/gate-quality tests/gate-onboarding.test.ts tests/playwright/herdweb-visual.spec.ts playwright.visual.config.ts AGENTS.md docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md
- **Accept-Check**：
  - `pnpm run ci-check` => exit 0
  - `pnpm exec vitest run tests/gate-onboarding.test.ts` => exit 0
  - `./node_modules/.bin/playwright test tests/playwright/herdweb-visual.spec.ts --config=playwright.visual.config.ts --workers=1 --retries=0` => exit 0
- **高风险区域**：caller 的 `with:` 契约、`secrets:` 透传方式、公开仓危险触发器白名单。

## 实现要点（照抄平台真身，不自创）

1. **`gate.yml`** —— 以 `gate-hub/.github/workflows/gate.yml` 为模板，差异只有三处：
   - workflow `name: gate` 与 job id `gate`（required check 上下文 `gate / gate`，不得改名）；
   - `with:` 传 `tier: personal`（registry 与 `AGENTS.md` 的 `risk-tier: personal` 一致）、
     `runner: self`、`has_ui: true`；`control_runner` 不传（默认跟随 runner）；
     `review_exempt_paths` **不传**（仓里 `AGENTS.md`/`README.md` 是测试读取的规则源，参考 gate-hub #751 的教训）；
   - `on: pull_request: types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]`；
     `permissions: {actions: read, contents: read, pull-requests: write}`；`secrets: inherit`。
2. **`gate-shadow.yml`** —— 独立文件、独立 concurrency，workflow `name: gate-shadow`
   （**不得**叫 `gate`，否则抢 required check）；`paths-ignore: ['**.md', 'docs/**']`；
   `tier: personal`、`runner: self`；**不传 `has_ui`**（shadow 明确不镜像该输入）；**不写 `secrets:`**。
3. **`gate-disposition.yml`** —— `on: workflow_dispatch` 八个输入逐项声明，`with:` 逐项
   `${{ inputs.<name> }}` 全量转发：`pr_number`、`primary_run_id`、`primary_run_attempt`、
   `finding_id`、`reason`、`disposition`、`counterevidence_json`、`tracking_issue`。
   `uses: zlxlabs/gate/.github/workflows/gate-v2-disposition.yml@v2`，跟随 `@v2` 移动标签，
   不钉 40 位 SHA；解析出的 SHA 只作为运行证据回贴，不写进文件。job 权限
   `{actions: write, contents: read, pull-requests: read}`，`secrets: inherit`。
4. **`scripts/gate-quality`（新，chmod +x）** —— `gate-v2.yml:551-561` 以「文件存在且可执行」判定
   `quality-entry.outputs.mode == 'entry'`；缺了它就走 legacy 自动检测 + DEPRECATION warning。
   内容只有一行 `exec pnpm run ci-check`：给共享 quality 一个**稳定入口**，沿用仓内既有的 CI
   parity 命令（`ci.yml:57` 今天就跑它），不是新增一道质量检查，也**不**说明本仓当前没有阻断层
   （vitest + `test:pw` + biome + oxlint + typos + knip + publint + tsc + deploy 都在里面）。
   共享侧已 `mkdir -p "$GATE_ARTIFACT_DIR"`（`gate-v2.yml:551-553`）但 v2 里没有任何步骤上传它，
   把它当日志落点即可，别自养一个聚合器往里塞结果。
5. **`herdweb-visual.yml` + `tests/playwright/herdweb-visual.spec.ts` + `playwright.visual.config.ts`（均新）**
   —— 只写项目专属胶水；发布半一律 `uses: zlxlabs/gate-hub/.github/actions/ui-evidence-publish@main`：
   `jdx/mise-action@v3` 装本仓工具链（按 `mise.toml` 钉 node 22 / pnpm 11 / ttyd 1.7.7，**不要**
   照抄模板的 Python/uv）、`pnpm install`、`pnpm exec playwright install --with-deps chromium`、
   `playwright test -c playwright.visual.config.ts`、`@cyborgtests/reporter` CLI 直传 PWRS
   （title 含 `${{ github.event.pull_request.head.sha || github.sha }}` 完整 40 位），最后调共享 action
   （`e2e-status` / `head-sha` 必填）。
   - **不复用 `smoke.spec.ts`**：它已由 `ci-check` 的 `test:pw` 跑，走查要的是全程录像的独立用例集，
     并存会把同一批用例录两遍；`smoke.spec.ts` 本身不动。
   - **重置**：每条用例各自 `startIsolatedServe`（`tests/playwright/isolated-serve.ts:136`）拉新进程 +
     保留端口，没有跨 attempt 的脏状态，因此不需要模板那套 `POST /__e2e__/reset` 端点；配置写
     `retries: 0`，失败如实暴露而不是靠重试洗绿。
   - **`playwright.visual.config.ts` 为什么单消费者仍必要**：共享 action 只发评论、不搬运文件，
     report 必须由项目侧产出；且录像 / trace / HTML reporter / 单浏览器这些走查要求不能漏进
     `playwright.config.ts`（那会让整个 `test:pw` 每次都录视频）。它 import 共享配置再覆盖，
     不复制 project 定义。

## TDD 红绿判据

1. 红：接入前 `gate.yml` 不存在 → `gh workflow list --repo zlxlabs/herdweb | grep -c gate` = 0；
   红：`scripts/gate-quality` 不可执行 → quality job 必打 DEPRECATION warning。
2. 绿：三个 caller 通过 `actionlint`（无 `actionlint` 时用 `pnpm exec` 不可得则退到
   `gh workflow view gate.yml --yaml` 能解析 + 首次真实 run 不 `startup_failure`）。
3. 契约测试 `tests/gate-onboarding.test.ts`（vitest，只解析 YAML，不联网）：
   - `gate.yml` 的 workflow `name` 与 job id 均为 `gate`；
   - `gate-disposition.yml` 的八项输入声明与 `with:` 块逐项转发**一一对应**（少一项即红）；
     「转发」判据是 `with:` 里出现 `${{ inputs.<name> }}` **原样表达式**，不是值非空——
     `disposition` / `counterevidence_json` / `tracking_issue` 在平台侧是 `required: false`，
     空串合法（事实以 `gate-v2-disposition.yml` 的 `workflow_call.inputs` 为准）；
   - 三个 caller 全文不含 `pull_request_target|workflow_run|issue_comment|pull_request_review`；
   - `uses:` 中 gate 相关条目以 `@v2` 结尾（禁止钉 SHA）。
   **producer 必须是真身**：本仓 `.github/workflows/*.yml` 读文件解析；平台侧基准用 gate-hub 仓里
   现有的 caller 模板 / workflow 契约 fixture（或只读拉到临时目录的 `gate-v2.yml`），不允许在测试里
   手造一份八项输入再断自己。判据自检：临时改坏 caller（少转发一项）确认测试变红，再改回。
4. 端到端验收（**合并前**，用真实 Actions 取规模与耗时）：ready PR 上 `gate / gate` 的 `primary`
   job 真实执行，用 `gh pr checks <N>` 确认 job 级 conclusion 是 SUCCESS 而不是 SKIPPED；
   同时记录 quality job 时长与自托管池装浏览器的结果，不推到合并后验证。
5. UI 证据验收：同一 PR 上 `ui-evidence` 评论的链接可打开（PWRS 是 tailnet 内网地址，
   「可访问」= 仓库协作者在 tailnet 内打开），页面标题含完整 40 位 head SHA。

## 真实输入 / 发送边界

- 唯一「发送边界」是 caller → 可复用工作流的 `workflow_call` / `workflow_dispatch` 输入。
  断言它时必须断真实对象（读文件解析出的 `with:` 键集），不得在测试里自造一份输入再断言自己。
- 处置工作流的八项输入来自平台契约，**不是**来自本仓代码；本仓只负责逐项原样转发表达式，
  不校验、不补默认值、不因某项取空串就判「漏转发」。

## 失败可见性

- 失败可见性来源（形状 `command:<命令>` / `file:<路径>:<行>`）：
  `command:pnpm run ci-check`、`command:pnpm exec vitest run tests/gate-onboarding.test.ts`、
  `command:gh run view <run-id> --log-failed`、`file:tests/gate-onboarding.test.ts:<行>`、
  `file:scripts/gate-quality:1`、`file:.github/workflows/herdweb-visual.yml:<行>`。
- 每次真实 run 回贴 job 名 + **job 级 conclusion**（不信 aggregator 的 `reason` 字段）；
  draft 上 SKIPPED 不是通过，标 ready 后重跑。
- 缺浏览器 / 缺 `ttyd` / `node-pty` 构建失败：先核实平台前置（`ci` 池镜像与 mise 工具链），再去
  gate-hub 提 issue 描述镜像缺什么；**不在**本仓 workflow 里加 `apt-get install`、`continue-on-error`
  或跳过浏览器。本仓正常安装工具链（mise / node / pnpm / 浏览器）不受限制。
- 凭据类失败（`SILO_ACCESS_KEY 未传入`、reporter CLI 401）：停下上报，说明缺哪个 secret 的什么
  可见性；不在本仓塞凭据、不改 callee、不把 `runner` 改成 hosted 当绕过。

## 减法优先

- 不新建 CI 概念：caller 就是平台那三个文件；不写自定义 aggregator、不写本地 gate 脚本。
- `scripts/gate-quality` 只有一行 `exec pnpm run ci-check`，不挑子集、不加 retry / skip。
- 为了「跑得快」把 `test:pw` 拿掉、顺手给 `playwright.config.ts` 加录像这类减法一律不做；
  `ci.yml` 一个字不动（若平台 quality 与它重复跑测试，先报告成本再决定）。

## 收尾

- 同一个 PR 内完成并回贴：真实 quality job 结果、`gate / gate` 的 run / job 链接、走查 producer
  artifact → 共享发布 action → 可访问且标题含完整 head SHA 的报告链接。禁止先写「已接入」再补证据。
- `AGENTS.md` 的 `ui-evidence-exempt` 行：**本 PR 内先改成当前事实**（herdweb 已在 registry、
  `has_ui: true`、共享 action 可用），**只有发布真实成功后才删掉整行豁免**；发布没成功就保留豁免
  并写明缺哪一条。
- `ci.yml` 保持原样：`check` 是 main 的 required check，靠 workflow 总触发而非 `if:` 生效；
  `gate-shadow` 是非 required，`paths-ignore` 跳过 docs 不影响合并。接入 ≠ 已修改分支保护
  （required check 配置是仓库设置写操作，不在本卡）。
- 进度存档：`docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md`。
