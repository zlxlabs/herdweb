# 任务卡：接入 gate v2 主门禁 + UI 录屏发布（#178 单 PR）

> 草案，供 Pi 主脑审定后派出。Task-Id 留空，由派发分配。

## 目标

在 zlxlabs/herdweb 仓内落三个平台 caller + 真实阻断层入口 + 一条 Node 适配的 UI 走查流水线，
让 **ready（非 draft）PR** 上 `gate / gate` 主审真实执行（非 SKIPPED），并产出一条可打开、
标题含完整 40 位 head SHA 的 `ui-evidence` 报告链接；合并后删除 `AGENTS.md` 的录屏豁免。
复用平台 caller/共享 action，不复制平台实现，不新造 CI 流水线。
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

- **Task-Id**：（派发分配）
- **Fixes-Issue**：Refs #178（提交信息禁止写 `Fixes #178` 自动关单）
- **Verify-Mode**：command
- **Verify-Command**：`git diff --check`
- **Narrow-Verify**：`node --experimental-strip-types -e "1" ; ./node_modules/.bin/playwright test tests/playwright/smoke.spec.ts --project=chromium-android --workers=1 --retries=0`（确认走查胶水没有打断现有浏览器阻断层）
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：750
- **阶段**：planning
- **锁定决策**：禁止调大 timeout/retries、禁止 skip/continue-on-error 装绿；禁止自动重试门禁；
  接入必须复用平台 caller 与共享 action；不改平台安全策略；只加法（减法优先：能不加就不加）。
- **任务类型**：integration
- **复杂度**：M
- **Base commit**：`1e6619837fa42b1b76ce87049172201fab215ef1`
- **Depends-On**：无（可与 #147 诊断卡并行，两者不碰同一文件）
- **Branch**：`chore/261012-gate-onboarding`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：由 delegate 派发决定
- **子代理 fan-out**：0
- **提交授权**：授权 commit+push
- **计划者与审查者**：Pi lead

## 修改边界

- **允许**：`.github/workflows/gate.yml`（新）、`.github/workflows/gate-shadow.yml`（新）、
  `.github/workflows/gate-disposition.yml`（新）、`.github/workflows/herdweb-visual.yml`（新）、
  `scripts/gate-quality`（新，可执行）、`.devcontainer/devcontainer.json`（新或按模板改）、
  `AGENTS.md` 的 `ui-evidence-exempt` 一行（**仅在验收三条件全成立后**）、
  `docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md`（新）。
- **禁止**：`src/**`、`tests/**`、`package.json`、`pnpm-lock.yaml`、`.github/workflows/ci.yml`、
  任何其它仓文件；已有历史 session 记录不得改写。
- **验证根豁免**：`.github/workflows/`（本卡的核心交付就是这三个 caller，豁免范围仅限上面列出的 4 个新文件）。
- **Scope-Globs**：`.github/workflows/gate.yml` `.github/workflows/gate-shadow.yml`
  `.github/workflows/gate-disposition.yml` `.github/workflows/herdweb-visual.yml`
  `scripts/gate-quality` `.devcontainer/*` `AGENTS.md`
  `docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md`
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
4. **`scripts/gate-quality`（可执行，chmod +x）** —— `gate-v2.yml:554-561` 以「文件存在且可执行」
   判定 `quality-entry.outputs.mode == 'entry'`；缺了它就走 legacy 自动检测 + DEPRECATION warning。
   入口只做一件事：在仓根跑真实阻断层（`pnpm run ci-check`，或按 runtime 拆分但**必须包含
   `pnpm run test:pw` 与 `pnpm run check`**），并把 `GATE_ARTIFACT_DIR` 用上。禁止在脚本里
   加 retry/skip。
5. **`herdweb-visual.yml`** —— 只写「项目专属胶水」：装依赖（`mise` + Node 22 + pnpm 11，
   按 `mise.toml` 钉版本；**不要**照抄模板的 Python/uv + npm 工具链）、起 `herdweb serve`
   临时实例并等就绪、跑本仓 `@playwright/test` 走查（trace/video/screenshot 全 `on`、
   `fullyParallel: false`、单一 spec 文件），再用共享 action 发报告：
   `uses: zlxlabs/gate-hub/.github/actions/ui-evidence-publish@main`。
   报告标题必须含 `${{ github.event.pull_request.head.sha || github.sha }}` 完整 40 位；
   只装 chromium；上传单目录 `playwright-report`（根含 `index.html`）。
   本仓**没有** `POST /__e2e__/reset` 契约，因此走查必须自建 reset 或按独立用例型配
   `test.beforeEach`，不得盲抄模板的 `beforeAll` journey 形态。

## TDD 红绿判据

1. 红：接入前 `gate.yml` 不存在 → `gh workflow list --repo zlxlabs/herdweb | grep -c gate` = 0；
   红：`scripts/gate-quality` 不可执行 → quality job 必打 DEPRECATION warning。
2. 绿：三个 caller 通过 `actionlint`（无 `actionlint` 时用 `pnpm exec` 不可得则退到
   `gh workflow view gate.yml --yaml` 能解析 + 首次真实 run 不 `startup_failure`）。
3. 契约测试（新增一个仓库内检查脚本或既有 vitest 用例，**只解析 YAML，不联网**）：
   - `gate.yml` 的 workflow `name` 与 job id 均为 `gate`；
   - `gate-disposition.yml` 的八个输入与转发 `with:` 键**完全一致**（少一个即红）；
   - 三个 caller 全文不含 `pull_request_target|workflow_run|issue_comment|pull_request_review`；
   - `uses:` 中 gate 相关条目以 `@v2` 结尾（禁止钉 SHA）。
   把这四条写成失败会变红的断言（先写一个故意少转发一项的 fixture 验证判据会红）。
4. 端到端验收（合并前）：ready PR 上 `gate / gate` 的 `primary` job **真实执行**且非 SKIPPED
   （用 `gh pr checks <N>` 确认 conclusion 是 SUCCESS 而不是 SKIPPED）。
5. UI 证据验收：`ui-evidence` 评论里的链接可打开，页面标题含完整 40 位 head SHA。

## 真实输入 / 发送边界

- 唯一「发送边界」是 caller → 可复用工作流的 `workflow_call` / `workflow_dispatch` 输入。
  断言它时必须断真实对象（读文件解析出的 `with:` 键集），不得在测试里自造一份输入再断言自己。
- 处置工作流的八项输入来自审计结论，**不是**来自本仓代码；本仓只负责原样转发，空串也算转发。

## 失败可见性

- 每次真实 run 必须回贴：`gh run view <run-id> --json jobs` 的 job 名 + conclusion（用 run/job 级
  `conclusion`，不信 aggregator 的 `reason` 字段）。
- 若 `quality` job 报缺浏览器/缺 `ttyd`/`node-pty` 构建失败：**停下上报**，在 gate-hub 提
  issue 描述镜像缺什么，禁止在本仓 workflow 里加 `apt-get install`、`continue-on-error` 或跳过浏览器。
- 若 `primary` 在 draft 上 SKIPPED：标记 ready 后重跑，别把 SKIPPED 记成通过。

## 减法优先

- 不新建任何 CI 概念：caller 就是平台那三个文件；不写自定义 aggregator、不写本地 gate 脚本。
- 不为了「跑得快」把 `test:pw` 从阻断层拿掉，也不在 `scripts/gate-quality` 里挑子集。
- 不动 `ci.yml`；若平台 `quality` 与 `ci.yml` 重复跑测试，**先报告成本再决定**，不在本卡裁剪。

## 收尾

- 回传 gate-hub #801：三个 caller 的实际路径、`gate / gate` run/job 链接、解析后的 40 位 SHA、
  触发器白名单审计输出。禁止先写「已审计运行」再补证据。
- 删除 `AGENTS.md` 的 `ui-evidence-exempt` **只在验收三条件全成立后**；否则保留并在本卡报告里
  写明缺哪一条。
- 进度存档：`docs/sessions/herdweb-261012-triage/progress/gate-onboarding-progress.md`。
