# notify-attention R3 终轮审查 · verdict（文档-实现一致性）

## 审查元数据

| 项 | 值 |
|---|---|
| 审查范围（冻结 H0） | `a9ee03b..743ed88` |
| t4 文档子范围 | `eb0d09e`（README）→ `fd3f818`（skill）→ `5ae1533`（goals）→ `fee92e6`（AGENTS/deploy）→ `2b6ca37`（GOALS 索引） |
| 审查人 | delegate 派发独立审查（Cursor，文档-实现一致性视角） |
| 风险等级 | infra 例外 |
| Spec | `docs/sessions/260822-2132-notify-attention/HANDOFF.md` + t4 文档增量 |
| 前置轮次 | R1（fail→修）、R2（pass，0 新增 P1） |
| 本轮新证据 | ① `git diff eb0d09e^..fee92e6 --name-only` 隔离 t4 仅 5 个文档文件；② `git show a9ee03b:<path>` 逐条对照 README/skill/AGENTS/deploy/goals 技术断言与实现；③ `routes.ts` 核对 `notify.token` 实际守卫范围；④ R2 verdict（`743ed88`）只读继承，不重开 R1/R2 代码 findings |

## 一、增量改动清单确认

### 1.1 t4 文档四提交 + GOALS 索引（`eb0d09e^..2b6ca37`）

| 提交 | 文件 |
|---|---|
| `eb0d09e` | `README.md` |
| `fd3f818` | `.agents/skills/herdweb-setup/SKILL.md` |
| `5ae1533` | `goals/M4-notify-attention.md` |
| `fee92e6` | `AGENTS.md`, `docs/deploy-herdr.md` |
| `2b6ca37` | `GOALS.md` |

**结论**：仅 `docs/`、`goals/`、`AGENTS.md`、skill 路径；**无 `src/`、`tests/`、`styles/` 生产代码或测试改动**。符合 t4 收尾卡预期。

### 1.2 完整范围 `a9ee03b..743ed88` 额外文件

除 t4 文档外，该 SHA 范围还包含合并进来的非 t4 变更（**不在 t4 文档子范围，本轮不重审代码**）：

| 类别 | 文件 |
|---|---|
| R2 审查产物 | `docs/sessions/260822-2132-notify-attention/reviews/notify-r2-verdict.md` |
| 卡文件 | `docs/sessions/cards/notify-r2-review.md`, `notify-t4-docs-closeout.md` 微调 |
| 其他合并 | `styles/base.css`, `tests/safe-area.test.ts`, `CHANGELOG.md`, `retro/acceptance-log.jsonl`, PWA safe-area R1 verdict |

**结论**：t4 文档增量本身无代码；全范围 diff 因 merge 含无关 src/tests，与卡面「t4 文档四提交」描述一致，不构成本轮 P1。

## 二、文档技术断言逐条核对表

对照基线实现 commit `a9ee03b`（R2 审查终点，含完整 notify 代码）。

| # | 文档断言 | 来源 | 代码事实 | 一致？ |
|---|---|---|---|---|
| D1 | ☰ 抽屉 → 🔔 打开通知面板 | README, skill | `defaultDrawerButtons` 含 `id: 'notify-panel'`, `action: { type: 'notify-panel' }` | ✅ |
| D2 | `notify-panel` 为合法 `ButtonAction` | skill, AGENTS | `config-schema.ts` `notifyPanelActionSchema` | ✅ |
| D3 | `notify` 为合法根配置键 | skill | `config-schema.ts` `notifyOverridesSchema` / `defaultNotify` | ✅ |
| D4 | iOS 须主屏 PWA（`display-mode: standalone`）；Safari 标签不可订阅 | README, skill, goals | `notify-panel.ts` `isStandaloneDisplay()` + `iosHint` 非 standalone 时显示 | ✅ |
| D5 | 面板：Push notifications 开关、Send test notification、历史「历史」 | README, skill | `notify-panel.ts` 对应 UI 文案与 `historyTitle` | ✅ |
| D6 | 状态目录 `~/.local/state/herdweb/{port}/`（或 `$XDG_STATE_HOME`） | README, skill, deploy, goals | `state.ts` `resolveNotifyStateDir(port)` | ✅ |
| D7 | 7681/7691 按端口分仓 | README, deploy, goals | `resolveNotifyStateDir(port)` 路径含 `String(port)` | ✅ |
| D8 | `vapid.json` mode `0600`，首次 serve 自动生成 | README, deploy | `push.ts` `writeJsonFileAtomic(..., 0o600)`；`serve.ts` `ensureVapidKeys` + 启动日志 | ✅ |
| D9 | `push-subscriptions.json`、`events.jsonl`、`last-session.json` | README, skill, deploy | `push.ts` / `state.ts` 常量文件名一致 | ✅ |
| D10 | `kind=test` 不落盘 `events.jsonl` | README, deploy | `state.ts` `appendEventLine`：`if (event.kind === 'test') return` | ✅ |
| D11 | `notify.history.limit` 默认 `200` | skill | `config.ts` `history: { limit: 200 }` | ✅ |
| D12 | `notify.silence.enabled` 默认 `true` | skill | `config.ts` `silence.enabled: true` | ✅ |
| D13 | `notify.silence.busyMs` 默认 `30000` | skill | `config.ts` `busyMs: 30_000` | ✅ |
| D14 | `notify.silence.quietMs` 默认 `180000` | skill | `config.ts` `quietMs: 180_000` | ✅ |
| D15 | `notify.silence.cooldownMs` 默认 `600000` | skill | `config.ts` `cooldownMs: 600_000` | ✅ |
| D16 | 静默车道典型延迟 ~3–5 分钟 | README, skill, goals | 最小路径 busy 30s + quiet 180s ≈ 3.5 min；含 cooldown 可达 ~5 min | ✅ |
| D17 | `POST /api/events` 仅回环（127.0.0.1/::1/localhost） | README, skill, deploy | `routes.ts` `isLoopbackRequest` → 非回环 403 | ✅ |
| D18 | 可选 `notify.token` → `Authorization: Bearer` on `POST /api/events` | README, skill | `routes.ts` `checkBearerToken` on events route | ✅ |
| D19 | `POST /api/events` 返回 HTTP `202` | README | `routes.ts` `c.body(null, 202)` | ✅ |
| D20 | `202` ≠ 手机已展示 | README, goals | 语义陈述（队列接受），与 `dispatchEvent` 异步推送一致 | ✅ |
| D21 | badge 车道 `asking`/`done`/`ci-red` **尚未可用**，依赖 agent-config#495 | README, skill, deploy, goals | 事件 schema 接受这些 kind，但文档均标明需外部源+#495；**未虚标为已上线** | ✅ |
| D22 | badge 典型延迟 60–90s（接线后） | README, goals | 前瞻描述，标注「when wired / 未合入前不可用」 | ✅ |
| D23 | 健康车道：PTY 退出推送；>120s 间隔才额外推「重启」 | README, deploy, goals | `health.ts` `RESTART_ANNOUNCE_GAP_MS = 120_000`；`shouldAnnounceRestart` 用 `>` | ✅ |
| D24 | 120s 内 crash-loop 只应一条退出类通知 | deploy, goals | `shouldAnnounceRestart`：gap≤120000 → false | ✅ |
| D25 | 停机：await 在途推送后 `server.close()` | deploy | PTY exit 路径：`notifyDrain` → `dispose` → `server.close()`（`serve.ts:798-801`） | ✅ |
| D26 | SW 位于 `{basePath}/sw.js`，无 fetch handler | AGENTS | `serve.ts` route `/sw.js`；`sw-entry.ts` 无 `fetch`/`respondWith` listener | ✅ |
| D27 | AGENTS 列出的 `src/notify/*`、`notify-panel.ts`、`sw-entry.ts` 模块 | AGENTS | `a9ee03b` 树存在对应路径 | ✅ |
| D28 | curl smoke：`kind:"test"` 示例 | README | `parseNotifyEvent` 接受 `test`；events 路由回环+202 | ✅ |
| D29 | `notify.token` 亦用于 push subscribe/delete | skill | subscribe/delete 路由仅 `requireOrigin`，**无** `checkBearerToken` | ❌ ≤P3 |
| D30 | 停机顺序「PTY exit → 写 last-session → await 推送」 | deploy | 实际 `handleSessionExit` 先 `dispatchEvent`（健康）再 `updateLastSessionEntry`，再 drain | ❌ ≤P3（省略 dispatch 步，关键 drain-before-close 仍成立） |

## 三、文档类红线（badge 虚标）

| 检查项 | 结论 |
|---|---|
| badge 车道（asking/done/ci-red）是否写成已可用？ | **否** — README 表格、skill、deploy、goals 均明示 #495 未落地前不可用 |
| 是否承诺 60–90s agent 告警已上线？ | **否** — skill 写明 "do not promise 60–90s agent alerts yet" |

**无 P1 虚标。**

## 四、R3 findings

| ID | 级别 | 摘要 | 违反条款 | 处置 |
|---|---|---|---|---|
| F-R3-P3-1 | P3 backlog | skill 称 `notify.token` 守卫 subscribe/delete，实现仅 origin 校验 | skill 配置表 D19 | 接受不修；token 设计本为回环 events API |
| F-R3-P3-2 | P3 backlog | deploy 停机顺序未写 health dispatch 先于 last-session 写入 | deploy 重启节 D30 | 接受不修；drain-before-close 正确 |

**新增 P1 数 = 0**

## 五、收敛判定

| 轮次 | 视角 | 新增 P1 |
|---|---|---|
| R2 | 代码全量 + 对抗（静默/健康/历史） | 0 |
| R3 | 文档-实现一致性（本轮） | 0 |

**infra 例外收敛条件「连续 2 轮无新增 P1」：满足**（R2=0，R3=0）。

## 六、最终 verdict

**pass** — t4 文档增量无代码改动；技术断言与 `a9ee03b` 实现逐条核对，badge 车道未虚标；**新增 P1 数 = 0**。
