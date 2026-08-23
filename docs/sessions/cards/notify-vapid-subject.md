# 任务卡：VAPID subject 修复 — Apple 推送服务拒收 localhost subject + 配置覆盖不生效

## 目标

真机 iOS 排障实证的两个缺陷：

1. **F-P1-5**：默认 VAPID subject `mailto:herdweb@localhost` 被 Apple 推送服务拒收：`403 {"reason":"BadJwtToken"}`（保留 TLD 邮箱不是合法联系人）。Google/FCM 不校验 subject，所以 Android 全程正常——iOS 静默无通知，且服务端会把被拒订阅当 stale 删掉。实测：同一密钥对仅换 subject 为 `mailto:admin@example.com` → Apple 返回 `400 BadWebPushToken`（VAPID 认可、假 token 被拒），证明 Apple 只要求格式合法的 mailto 联系人，example.com 也接受。
2. **F-P2-8**：`ensureVapidKeys` 对已存在的 vapid.json，subject 解析为 `existing.subject ?? subject`——磁盘旧值赢了配置覆盖。轮换场景改 `notify.vapid.subject` 完全不生效（测试实例实证：改配置重启后仍是旧 subject，只能手工改磁盘文件）。

修复后：默认值即可通过 Apple 校验；配置 subject 永远生效。

## 非目标

- 不换默认密钥对生成逻辑；不动订阅/推送流程；不加新配置键。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test
- **Diff-Lines-Target**：100
- **Diff-Lines-Hard**：250
- **阶段**：repairing
- **root_cause_group**：VAPID 元数据（subject）默认值不可投递 + 覆盖优先级颠倒（磁盘 > 配置）
- **introduced_by_commit**：5ba8dff（t1 ensureVapidKeys 初版）
- **open_findings**：
  - F-P1-5：默认 subject `mailto:herdweb@localhost` → Apple 403 BadJwtToken（实测锚点：主脑 apple-probe.mjs 输出）
  - F-P2-8：subject 覆盖不生效（实测锚点：磁盘 subject 在配置覆盖后保持 localhost，主脑手工改盘修复）
- **锁定决策**：
  1. **默认值**改为 `mailto:admin@example.com`（格式合法、Apple 实测接受；开源默认值不写死私人域名）。
  2. **解析优先级**（关键语义变更）：**keypair** 仍为 override 完整对 → 磁盘 → 生成；**subject 单独解析**：`override?.subject ?? 磁盘 existing.subject ?? 新默认`——即 subject 跟配置走、磁盘只是记忆、默认兜底。理由：subject 是可随时换的联系元数据（不 invalidate 订阅），keypair 才是身份（换了订阅全废）。
  3. **写盘同步**：当「本次解析出的 subject」≠ 磁盘 subject 时，用 writeJsonFileAtomic 把磁盘文件更新为实际生效值（保证 vapid.json 永远反映运行时真相；keypair 不变所以无订阅失效风险）。
  4. **README + skill 补一段**（t4 已有 VAPID 节，追加即可）：Apple 对 VAPID subject 严格校验（必须是格式合法的 mailto 联系人，localhost 等保留域会被 403 拒收且无任何服务端可见错误）；建议生产配置 `notify.vapid.subject: 'mailto:<你的邮箱>'`。位置：README「Push notifications」节 VAPID 表格后 + `.agents/skills/herdweb-setup/SKILL.md` Phase 5 的 notify 配置表附近。
  5. **测试**（tests/notify-push.test.ts 扩）：
     - 新默认值断言：fresh stateDir 生成 → subject === 'mailto:admin@example.com'
     - subject 覆盖：磁盘写旧默认 + override 给新 subject → 返回 override 值 **且** 磁盘被同步更新
     - 磁盘记忆：磁盘有 subject + 无 override → 返回磁盘值
     - keypair 语义回归：磁盘有完整 keypair + override 只给 subject（不给 keypair）→ keypair 仍用磁盘的（订阅不失效）
     - 格式守卫：默认 subject 匹配 `/^mailto:.+@.+\..+$/`（防未来再改回不可投递值）
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：3d56a08（feat/notify-attention tip）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：是， delegate 创建
- **当前唯一写入者**：delegate 派发的执行器
- **执行器与模型**： delegate 派发，按 envelope 实际值回填
- **执行器角色声明**（codex / grok 卡必带，原样抄）：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：Sisyphus（主脑）拆卡与验收（主脑持 Apple 真端点探针与真机环境做终验）

## 修改边界

- **允许**：`src/notify/push.ts`、`tests/notify-push.test.ts`、`README.md`（仅 VAPID 节）、`.agents/skills/herdweb-setup/SKILL.md`（仅 notify 配置节）
- **禁止**：`herdweb.config.ts`（worktree 根那个是主脑排障用的本机文件，不得提交）、其余一切文件、`.github/workflows/**`
- **验证根默认禁止**：`.github/workflows/`（所有仓）
- **Scope-Globs**：src/notify/push.ts tests/notify-push.test.ts README.md .agents/skills/herdweb-setup/SKILL.md
- **高风险区域**：keypair 语义不得变（磁盘 keypair 优先于「只给 subject 的 override」）——变了会作废全部既有订阅

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：锁定决策 5 全部测试绿。
- **相关测试**：`pnpm test`（全量）。
- **概率性验收**：不适用。
- **接口契约**：`ensureVapidKeys(stateDir, override?)` 签名不变；语义变更如锁定决策 2。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip` 四道全绿（报告贴结果）。
- **截图或探活**：不适用。
- **现场还原**：停在 delegate 分配分支；不删 worktree。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。**本卡具体节奏**：push.ts+测试一次、文档一次，≥2 commits。
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

- **现场事实（主脑预取）**：Apple 实测数据——旧 subject `mailto:herdweb@localhost` → 403 BadJwtToken；`mailto:admin@example.com` → 400 BadWebPushToken（VAPID 通过）；测试实例磁盘已手工改 subject 且 iPhone 真机全链路（订阅→测试通知→收到）已验证通过。`src/notify/push.ts:30` 为默认值行、`:44` 为磁盘短路行。
- **机理/根因陈述**：`Apple 校验 VAPID JWT subject 必须为合法 mailto；localhost 保留 TLD 被拒`（证据锚点：主脑 apple-probe 输出 403/400 对照）；`existing.subject ?? override 使磁盘旧值赢过配置`（证据锚点：push.ts:44）。
- **已完成**：根因定位 + 真机验证（主脑）。
- **未完成**：代码修复 + 文档。
- **关键决策**：见锁定决策 2（subject 与 keypair 分离解析）。
- **已否决方案**：默认值写死私人域名（开源仓）；换默认密钥对（作废全部既有订阅）。
- **修改文件**：见 Scope-Globs。
- **测试及结果**：待执行。
- **已知问题**：无。
- **下一步唯一动作**：修复 + 测试 + 文档并提交。
