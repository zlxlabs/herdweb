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
  在整仓并行跑时间歇 `spawnSync ps ENOBUFS` —— 测试的 finally 清理段与
  `orphanedServePids()` 断言助手的 `execFileSync('ps', …)` 均未设 maxBuffer
  （默认 1 MiB），本宿主 ps 输出实测 1.10–1.13 MiB（其他 delegate 的大 argv
  进程主导），全仓并行时 worker 进程再推高输出越线；隔离跑 3/3 绿。
  三次完整链路跑（22:22 / 22:24 / 22:44）均只红这同一条，其余 84/85 文件、
  1551/1552 用例全绿；测试文件不在本卡 Scope，不修；与本卡 16 个改动文件
  无导入/运行关系（新红：无）。无主干基线可比，按卡规则标「未能判定（无基线）」，
  但三连同因复现 + 机制独立于本仓状态。
- 最终 CI 验收留痕：整仓 `pnpm run ci-check` 未达 exit 0，唯一原因即上条继承红；
  其余链路分段取证全绿（test:coverage 1551、build:dist、test:pw 152/152 exit 0、
  biome 整仓、lint:ox/typos/knip/publint、tsc、test:deploy）。

## 里程碑 3：push 被预推公开扫描拦下（blocked，待主脑仲裁）

- 阶段：implementing → blocked
- 事实：`git push` 被 agent-config pre-push public-scan 拒绝：
  `.github/workflows/herdweb-visual.yml:103:cgnat_ip` —— 该行是平台模板
  `templates/ui-visual/workflow.yml` MagicDNS 解析步骤的原文字节
  （`dns.sendto(packet, ("100.100.100.100", 53))`，Tailscale 固定解析器）。
  同一字面量存在于平台自己的公开仓 zlxlabs/gate `gate-v2.yml:983/1173/1750/1232`。
- 全量待推 diff 重跑 outbound_scan：恰好 1 处命中，无其它公开内容问题。
- 未采取的动作（均属自批/绕过，禁）：`CC_PRE_PUSH_PUBLIC_SCAN_OFF=1` 越过、
  改扫描器、把 IP 改写成等价变体（洗白）。扫描器与守卫脚本均无本仓可编辑的白名单。
- 待主脑三选一：(a) 授权本次 push 用守卫自带 bypass 环境变量；(b) 授权带适配的
  替换写法（如 resolver 地址从 repo VARIABLE 注入，需一次仓库设置写权）；
  (c) 平台侧改（gate-hub 模板把 resolver 字面量收进共享 action 或提供公开仓变体）。
- 本地 4 个 commit 待推：8dc8a7c（设计，已推）之后的 10be0c8 / e5235b6 / 884f01a /
  096acb6；draft PR #212 head 仍停在 8dc8a7c。
- 已知良性噪声（预存，非本卡引入）：`tests/client-connection.test.ts` 按既有行为
  对默认端口 localhost:3000 探测并打印 ECONNREFUSED stderr，不影响退出码。
- 下一步唯一动作：docs commit（AGENTS.md 豁免理由更正 + 本 progress）→ 单轮 push →
  gh 读一次远端 run 状态入档。

## 里程碑 4：H1 单轮局部修复（dlg-20261012-160531-0ae9e6，F1–F4，只本地 commit）

- 输入：独立审查 verdict（`git show fb966e39822e16e23c28f1cda8591387d2edd417:
  docs/sessions/herdweb-261012-triage/reviews/gate-onboarding-verdict.md`）。
- F1：`herdweb-visual.yml` job 级 `if`（搜 `Trusted-event admission`）：同仓 PR 且
  作者非 dependabot[bot]，或显式 workflow_dispatch（短路在前，不触碰 PR 字段）；
  不用 github.actor；`approval_policy=all_external_contributors` 保持未重复 PUT。
- F2：`playwright.visual.config.ts` 新增 `outputDir: test-results/visual-artifacts`，
  与报告目录同父兄弟；契约测试用 path 数学断言互不嵌套（非两字符串）。
- F3：上传步 `id: upload`；发布步加 `steps.upload.outcome == 'success'` 门槛
  （搜 `F3:`）；`e2e-status` 仍取原始 `steps.e2e.outcome`。
- F4：真实模板切片 fixture（gate-hub `templates/ui-visual/workflow.yml` 冻结对象
  d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4，第 177–190 行，blob/hash/适配差异在
  `tests/fixtures/gate-onboarding/SOURCE.md` 搜 `template-ui-visual`）；只切上传步，
  不复制 MagicDNS 步（不新增公开扫描命中）。producer 测试（test 文件搜
  `upload producer`）：真实 YAML run 块 → `bash -e`（GitHub Linux 默认，无
  pipefail 声明）+ fake npx 收 NUL 分隔逐 token argv，断全参数与两 package 版本、
  uploader 17→shell 17、空 token exit 1+marker+npx 未调用；token 显式虚构。
- 红验：H0 上 3 条新断言 AssertionError（job.if / id+门槛 / outputDir 缺失）；
  变异 ×3（删发布门槛、title 去 40 位 SHA、删准入项）均 AssertionError 后
  byte-identical 还原复绿。事故记录：变异还原误用 `git checkout --` 连带回退了
  未提交实现，已重放并改用精确反向替换。
- 真实 CLI（TMPDIR=/tmp）：visual 2 passed (4.3s) 无 Configuration Error；
  `test-results/visual-artifacts/` 2×video+2×trace；报告内嵌模型 12 条附件引用
  全为相对 `data/<sha>` 且落盘可解析。本会话 dispatch env 即深路径 TMPDIR，
  serve setup 30s 超时 ×2，TMPDIR=/tmp 后消失（与里程碑 2 结论同因）。
- 完整质量：`TMPDIR=/tmp pnpm run ci-check` 单轮 exit 1——test:coverage 绿
  (1560/1561，无 ps ENOBUFS)，test:pw 62 failed/81 passed 后链停；独立复跑
  test:pw 52 failed/84 passed/8 skipped；两轮失败集合不相交（18–19 个 spec
  文件受影响、非确定性），隔离探针三组（sticky-ctrl+dpad、asr+combo-encoding）
  全绿 → 归因宿主并行竞争（他 delegate 在跑），非本卡改动（改动不在共享套件
  导入图）。两次未收敛，按卡停止。其余分段单独全绿：build:dist / check（一次
  biome 格式修正后）/ lint:ox / lint:typos / lint:knip / lint:publint / tsc /
  test:deploy / 窄测 58/58 / 窄 visual 2/2。完整链未在单轮内 exit 0，不称全绿。
- 预算：累计 additions 2096 / 2100 硬上限（fable 估 120–180，
  实际本轮新增 332，主因 producer spawn 矩阵与准入/发布断言）。
- 风险与缺口：job 级 if 与发布门槛为 GitHub 表达式，actionlint 绿但真实验值待
  managed CI；真实 Actions/PWRS/PR 评论链 pending（lead 验收）；push 仍被
  agent-config#4581 挡（实测 OPEN，未放行）→ 只本地 commit 不 push。
- 下一步唯一动作：#4581 正式放行后单轮 push 本地 2+1 commit 并 ls-remote 核实。
