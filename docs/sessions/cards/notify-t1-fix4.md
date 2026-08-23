# 任务卡：注意力层 v1 · fix4 — Tailscale 域名下手机面板三处 403（部署路径 P1）

## 目标

修复 Tailscale 测试环境实测发现的部署路径 P1：手机经 `https://<tailnet-host>/herdweb-notify` 访问时，通知面板三处请求全部 403，订阅流程完全不可用。修后面板在非回环域名下全流程可用。

**实测证据（主脑，chromium 91 探针 + curl）**：
- `GET /api/push/vapid-key` → 403：chromium same-origin GET fetch 不带 Origin 头，`isAllowedOrigin(undefined, host)` 回退只放行回环主机名（src/serve.ts:191-197），tailnet 域名被拒
- `GET /api/events/history` → 403：同上
- 面板测试按钮 `POST /api/events` → 403：该端点按锁定决策仅回环+token，手机必然非回环（src/controls/notify-panel.ts:331-338）

CI e2e 未发现的原因：测试主机是 127.0.0.1（回环主机名），三条路径全部走通。

## 非目标

- 不改 `POST /api/events` 的回环+token 设计（外部事件入口的信任边界，锁定决策不变）。
- 不动 push subscribe/DELETE（POST/DELETE 浏览器必带 Origin，现状可用）。
- 不加 token 到页面、不新增配置项。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：300
- **阶段**：repairing
- **root_cause_group**：鉴权拆分（锁定决策 4）实现时把「浏览器 GET 不带 Origin」与「测试按钮打的是仅回环入口」两个现实漏掉——回环域名 e2e 全绿掩盖了域名部署路径
- **introduced_by_commit**：9730a36（routes 鉴权）与 bce447f（面板测试按钮）
- **open_findings**：
  - F-P1-3a：vapid-key GET 在非回环域名 403（无 Origin 回退仅回环）
  - F-P1-3b：history GET 同上
  - F-P1-3c：面板测试按钮 POST /api/events 在手机上必然 403
- **锁定决策**：
  1. **GET vapid-key 与 GET history 去掉 requireOrigin**（保留限流）：两者只读、无 CORS 响应头（跨站页面读不到响应体），CSRF 面为零；这与静态资源（HTML/manifest/sw.js）从不禁 origin 一致。**不是**改 isAllowedOrigin 的回退语义（那会影响 POST 面）。
  2. **新增 `POST {basePath}/api/push/test`**：走 origin 校验 + push 限流（与 subscribe 同 posture）；服务端构造 `{v:1, kind:'test', title:'herdweb test', body:'Test notification from panel', ts:Date.now()}` 交给 `NotifyService.dispatchEvent`（kind=test 自动补 id、绕过落盘的既有语义不变）。**禁止**让 /api/events 接受非回环。
  3. 面板测试按钮改打 `/api/push/test`（POST 无 body 或空 JSON 均可），成功判定维持 status===202。
  4. SW 的 pushsubscriptionchange 不动（DELETE/POST 带 Origin，可用）。
  5. 测试：①routes 单测补「无 Origin GET vapid-key/history 在非回环 Host 下 200」（用非回环 Host 头模拟，这正是漏掉的场景）②「POST /api/push/test：合法 Origin → 202 且 dispatch kind=test；无 Origin 非回环 Host → 403；限流 → 429」③面板单测改断言新端点；④e2e notify.spec.ts 若直接 POST /api/events 的段落改走面板按钮或保留（回环下仍 202）但补一条走 /api/push/test。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：5d6b2c5（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是，delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 Tailscale 实测环境，修后主脑复测三 URL）

## 修改边界

- **允许**：`src/notify/routes.ts`、`src/controls/notify-panel.ts`、`tests/notify-routes.test.ts`（若在 routes 测试文件里；否则既有 notify 测试文件）、`tests/notify-panel.test.ts`、`tests/notify-panel-history.test.ts`、`tests/playwright/notify.spec.ts`
- **禁止**：`src/serve.ts` 的 `isAllowedOrigin` 本体、`src/notify/events.ts`、`src/notify/service.ts`、`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/routes.ts src/controls/notify-panel.ts tests/notify-events.test.ts tests/notify-panel.test.ts tests/notify-panel-history.test.ts tests/playwright/notify.spec.ts
- **高风险区域**：不得放宽 POST/DELETE 的 origin 面（subscribe/subscription/test 三个写端点必须有 origin 校验）

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 5 的三组测试全绿；主脑将在 Tailscale 环境复测（vapid-key/history 200、测试按钮 202）。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：新增端点 `POST {basePath}/api/push/test`（无请求体要求，202）；既有契约不变。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿。
- **截图或探活**：报告贴新增测试名。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：服务端（routes+测试）一次、面板切换+测试一次，≥2 commits。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md 正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取）**：Tailscale 探针实测三 URL 403（见目标节）；isAllowedOrigin 无 Origin 回退逻辑在 src/serve.ts:191-197；面板测试按钮在 src/controls/notify-panel.ts:329-346；既有 routes 测试全在回环语义下写就。测试实例 systemd unit `herdweb-notify-test`（7701，--base-path /herdweb-notify）由主脑保持运行，执行器无需操作网络面。
- **机理/根因陈述**：`same-origin GET fetch 不带 Origin → isAllowedOrigin 回退仅回环 → 域名部署 403`（证据锚点：src/serve.ts:191-197 + 主脑 chromium 探针输出 403）。
- **已完成**：问题定位与复现（主脑）。
- **未完成**：修复+测试。
- **关键决策**：GET 只读端点去 origin 闸（CSRF 面为零）；测试按钮走新 push/test 端点；/api/events 回环边界不动。
- **已否决方案**：放宽 isAllowedOrigin 全局回退（扩大 POST 面）；页面嵌 token（安全剧场）；/api/events 接受非回环（打破信任边界）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：按锁定决策修 routes + 面板 + 测试。
