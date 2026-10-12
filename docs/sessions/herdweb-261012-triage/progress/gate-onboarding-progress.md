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
