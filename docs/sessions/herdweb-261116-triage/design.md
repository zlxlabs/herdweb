# herdweb issue 分诊 2026-11-16：设计记录

用户原话：「分诊本仓 issues，看下怎么分批次处理，要求是第一性原理去思考，优先去消灭问题，而不是去打补丁。也咨询下 codex 意见」；方案经用户回复「好」认可。

## 结论表

| Issue | 根因 | 处置 | 卡 |
|---|---|---|---|
| #222 main CI 红 | `ci.yml` 用浮动标签 `ubuntu-latest`，GitHub 切到 26.04，Playwright 1.58.2 不支持 | 写死 `ubuntu-24.04`，系统升级成为显式动作；Playwright 升级另行验证 | A |
| #178 gate 接入 | 已于 PR #212 完成；PR #216 primary SUCCESS + 含完整 SHA 的报告链接 tailnet 200 | 删 `CLAUDE.md`/`AGENTS.md` 的 `ui-evidence-exempt` 段，合并后关单 | A |
| #221 通知契约漂移 | `ALLOWED_FIELDS` 对未知顶层字段整条拒收：producer 任何加字段都让通道全断（11-12 起 0 投递） | 未知字段忽略而非拒收，回执与决策日志列出被忽略字段；拒收日志带具体原因；不建契约导出与校验端点 | B |
| #217 serve-abuse 偶发超时 | 待定位；嫌疑 `declare-only` 声明长度不发 body | 定位挂起点，删除该发法或改为断言提前拒绝；不加超时/重试 | C |
| #218 root 下跳过的权限测试 | 非 root 的 `check` 已真实覆盖（本地 uid 1000 两例 ✓） | 关单，不加降权机制 | — |

## 锁定决策

- 不重跑、不加 timeout、不加 retry 来让 CI 变绿。
- #221：必填与路由字段（`v`、`targetId`、`kind`、`level` 等）校验不放宽；`host` 经核为展示用主机别名（agent-config `scripts/herdr/notify_host_alias.py`），不参与路由，忽略不致错投。
- #221 不做：机器可读契约同源导出、只解析不投递的校验端点（无第二消费者；出站告警归 agent-config#7504）。

## 顾问

codex（read-only）独立意见：同意先恢复 CI、#221 划掉已存在的回执/原因请求、#218 反对逐测试降权、#217 反对加时；提醒 `host` 若参与路由则忽略会静默错投——已核实不参与。
