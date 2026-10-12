# 接入进度：#178 gate v2 单 PR 接入（dlg-20261012-135141-70d90a）

> 执行器进度存档；每里程碑同 commit 保存。基线 `1e6619837fa42b1b76ce87049172201fab215ef1`。

## 里程碑 1：设计携带 + 前置收紧

- 阶段：implementing（首 PR 设计 commit）
- 结论：
  - 四份旧 design/triage/card/progress 从已核实提交
    `d9a40398fd93ec24eacffbf88f921e469ca997fa` 原样恢复进本 PR，作为首实现 PR 的设计部分；
    不从该分支建 base、不新开纯文档 PR。历史采样 JSON 与六个 sha256 未改动。
  - 条目级更正两处已否决旧措辞：design.md「send() 静默丢弃」→ 带提示拒发；
    triage.md「补 gate-quality 才有真实阻断层」→ 本仓 `ci.yml` 已具真实阻断，补的是稳定入口。
  - 本仓 fork PR 外部贡献者审批已收紧并回读核实：
    `PUT repos/zlxlabs/herdweb/actions/permissions/fork-pr-contributor-approval`
    `approval_policy=all_external_contributors`，PUT exit 0，GET 回读同值
    （2026-10-12；收紧前实测 `first_time_contributors`）。未批准任何外部 fork 运行。
  - 前置证据（2026-10-12，gh 实测）：gate-hub#1475 `state=CLOSED`（授权已供给）；
    本仓三个 repo secret 在册（PWRS_REPORTER_TOKEN / SILO_ACCESS_KEY / SILO_SECRET_KEY，
    value 不可读，有效性待真实 Actions 消费验证）；
    runner group 4 `ci`：`visibility=all`、`allows_public_repositories=true`、
    `restricted_to_workflows=false`。
  - #147 已按分诊关单（triage.md 结论），本卡不实施其任何诊断/修复方向。
- 关键决策：标准平台契约（caller 用 `@v2` 移动标签，解析 SHA 只作证据）；
  不增 fallback/retry/catch/skip；不自动降级 hosted；录屏豁免保留到主脑三条件验收。
- 已否决：跨仓实现、自建聚合/发布、复活 #147 诊断、提前删豁免。
- 下一步唯一动作：读平台实时指南与模板（只读，缓存本卡 /tmp），生成本仓四 workflow 与测试。

## 里程碑 2：实现 + 契约测试（红→绿）

- 阶段：implementing（PR #212，draft，分支 card/herdweb-261012-gate-onboarding）
- 平台只读核对（2026-10-12）：gate-hub 本地 `0a57417785b3ea80b0d260af7c1feb915873155d` ==
  远端 main；gate 本地 `f4213194f162062bc22d57cd6ac5589e97d920af` == 远端 main ==
  `refs/tags/v2`（移动标签已从 triage 时代的 `8d4106a4…` 前移，历史采样不动）。
  产出四 caller 按 templates/caller-ci.yml / caller-shadow-ci.yml /
  caller-disposition-ci.yml 与 templates/ui-visual/workflow.yml 真身生成；
  callee 合同以 gate 仓 `gate-v2.yml`（quality entry：存在且可执行→`mode=entry`，
  `mkdir -p "$GATE_ARTIFACT_DIR"` 由 callee 自建）与 `gate-v2-disposition.yml`
  （workflow_call 八输入，可选三项 `required: false`）为基准。
- 红先绿后：tests/gate-onboarding.test.ts 先落盘，首跑红
  （`Failed to resolve import "../playwright.visual.config"`，visual 链路未实现），
  实现后 50/50 绿、连续三跑 exit 0。
- 发现集对比：主配置 `testIgnore: ['**/herdweb-visual.spec.ts']` 下
  `playwright test --list` = 152 tests / 20 files，visual 条目 0；仅去掉该行
  （其余不变）= 156 / 21，差值恰为 visual spec 的 2 用例 × 2 project = 4 条发现项
  → 原 152 条一条未丢，visual 只被 visual 配置发现（2 tests / 1 file / chromium 单项目）。
- 本地 visual 实跑（chromium、1 worker、retries 0）：2 passed (10.3s)，真实媒体字节：
  `playwright-report/`（自包含 HTML，含 2 个 trace zip、2 个 webm、2 个 png，4.9 MiB）
  + `test-results/`（3.0 MiB）；两者均 .gitignore，不入库。
- 变异红验（注入生效，原样输出）：
  1. 删 gate-disposition.yml 的 `counterevidence_json` 转发行 →
     `AssertionError: expected undefined to be '${{ inputs.counterevidence_json }}'`，exit 1；
  2. 删 upload `--title` 里的 `${UI_EVIDENCE_HEAD_SHA}` →
     `AssertionError: expected '…' to contain '--title "$GITHUB_REPOSITORY ui-evidence ${UI_EVIDENCE_HEAD_SHA} (run ${GITHUB_RUN_ID})"'`，
     exit 1。两处均只还原注入行，还原后复测绿（exit 0）。
- 已知良性噪声：vitest happy-dom 环境导入 `@playwright/test` 会对
  `http://localhost:3000/`（happy-dom 默认 location）发一次无消费者请求，打印
  ECONNREFUSED；不影响退出码（多次复跑 exit 0），不引入补偿逻辑。
- actionlint：四个 workflow 全绿（`ci` 为 org 自托管池真实标签，经 /tmp 配置声明，
  不入仓）。
- 本地验收链（逐段执行，TMPDIR=/tmp 短临时目录，记差异）：test:coverage 1551 passed
  （见下条继承红）；build:dist ✓；test:pw 152/152 exit 0（visual spec 被主配置排除，
  阻断层完整）；biome 整仓 ✓；lint:ox / lint:typos / lint:knip / lint:publint /
  tsc / test:deploy 全 ✓；Narrow-Verify 两条各多次 exit 0。
- 媒体产物路径适配（记差异）：biome 1.9.4 的 `files.ignore` 对 `playwright-report/`
  实测不生效（`test-results/` 生效；biome.json 不在本卡 Scope），visual HTML 报告
  outputFolder 改为 `test-results/playwright-report`，workflow 上传路径同步，
  契约测试锁死两者一致；报告仍满足「单目录、根即 index.html」上传不变式。
- 继承红（机制归因，非基线比对；派发时主干基线不可用）：
  `tests/process-lifecycle.test.ts > isolated serve dies with the caller process`
  在整仓并行跑时间歇 `spawnSync ps ENOBUFS` —— 测试 finally 清理段
  `execFileSync('ps', ['-eo','pid=,args='])` 未设 maxBuffer（默认 1 MiB），
  本宿主 ps 输出实测 1.10–1.13 MiB（其他 delegate 的大 argv 进程主导），
  全仓并行时 worker 进程再推高输出越线；隔离跑 3/3 绿。测试文件不在本卡 Scope，
  不修；与本卡 16 个改动文件无导入/运行关系（新红：无）。
- 已知良性噪声（预存，非本卡引入）：`tests/client-connection.test.ts` 按既有行为
  对默认端口 localhost:3000 探测并打印 ECONNREFUSED stderr，不影响退出码。
- 下一步唯一动作：docs commit（AGENTS.md 豁免理由更正 + 本 progress）→ 单轮 push →
  gh 读一次远端 run 状态入档。
