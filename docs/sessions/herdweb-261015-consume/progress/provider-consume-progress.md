# provider-consume 进度（dlg-20261015-031835-30c7a8 / herdweb-20261015-01）

- 阶段/结论（2026-10-15）：消费已发布接口完成并落盘——gate.yml 开 `quality_prepare_mise: true`（gate#314，v2=c44e9e96），herdweb-visual.yml 发布步迁 public `zlxlabs/gate/.github/actions/ui-evidence-publish@v2` + 显式 `evidence-base-url: ${{ env.PWRS_BASE }}`（同 upload `--url` 的 job env；upload 成功才评论、真实 e2e outcome、同完整 head SHA、`pull-requests: write` 未动）。窄验 vitest 64/64 + tsc 绿；红验（改坏 URL 行→两断言期望-实际红→单行还原）通过。完整 `pnpm run ci-check` 两轮均 exit 1：r1 原环境死 coverage 段（delegate TMPDIR 深目录致 tsx socket 超 sun_path 108B，24 失败全在 spawn 类套件，与本 diff 无关）；r2 修 TMPDIR 后走到 test:pw 段，webkit/chromium worker 大量 SIGABRT——**实测加载 unit pids.max=1024≠卡面 3072，pids.events 0→172 次拒绝**，按卡面「触新 pids 拒绝→保现场上报」停手，未抬数字/未降 worker/未脱 cgroup。
- 关键决策：fixture 只保真实提供方字节片段——新增 `gate-v2-workflow-call-inputs.yml`（真 gate-v2.yml@v2 输入项，blob `ecc1fcfb…`）+ 既有 upload fixture 追加官方模板发布步（双 revision 出处记 SOURCE.md）；测试用真 producer 片段锁契约（caller 开关↔producer `default: false`、adapter 发布步↔官方消费模式，唯一 delta=upload id）。
- 否决方案：不复制 155KB 共享工作流、不造安装器/兼容层/新测试框架、不扩 fixture 为整文件、不删既有覆盖、不对环境红做第三次全量重刷。
- 下一唯一动作：主脑在 3072 unit（或托管 CI）环境重放原完整入口，或直接 ff 本分支进 PR212 以真实 GitHub CI 定局（Mise 准备→完整 quality→upload→同 SHA 评论）。
- 本卡 diff：实现 80 行（=硬线，`git show --stat 2d8b569`）；main..HEAD 累计 2282/2300；本进度文件为卡面强制交付，计入后 Base..最终 88。
