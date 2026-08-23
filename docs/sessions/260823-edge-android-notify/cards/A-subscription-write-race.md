# 任务卡：修复推送回写覆盖新订阅的竞态（订阅静默丢失）

## 目标

`pushToAll` 在推送开始时读取订阅快照，await 网络推送完成后把**旧快照**写回磁盘，
会覆盖掉 await 期间由 `POST /api/push/subscribe` 新增的订阅记录 —— 用户在手机上成功
订阅后，订阅被静默抹掉，此后收不到任何通知，且服务端无任何错误日志。

真机实证（2026-08-23，Edge for Android 151）：抓包确认设备发出 `POST /api/push/subscribe`
一次（其前后各夹着 `POST /api/push/test`），服务端 `push-subscriptions.json` 中始终只有
既有的 2 条记录（FCM 模拟器 + iPhone Apple），该设备端点从未落盘；文件 mtime 与最后一次
`notify push delivered` 日志时间一致（16:53:30），即最后写入者是推送回写而非订阅写入。

修复：推送流程对订阅文件的写回必须基于**磁盘最新内容**做增量合并（更新 lastSuccessAt、
删除 401/404/410 的失效端点），不得用推送开始时的快照整体覆盖。

## 非目标

- 不引入文件锁、不引入外部依赖、不改订阅文件格式。
- 不改 `/api/push/subscribe` 路由的鉴权/限流/校验逻辑（已验证正确）。
- 不碰客户端（Service Worker scope 问题由并行卡 B 处理，文件不重叠）。
- 不改 `pruneStaleSubscriptions` 的既有 `inFlight` 保护语义（但见下方轴表：它同样必须走合并写）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：180
- **Diff-Lines-Hard**：320
- **阶段**：repairing
- **锁定决策**：
  - 合并策略固定为「read 最新磁盘内容 → 按 endpoint 应用 delta → write」，delta 只含
    「lastSuccessAt 更新」与「失效端点删除」两类；期间新增的端点一律保留。
  - read→合并→write 必须在**同一同步块内**完成（其间不得有 `await`），依赖 Node 单线程
    保证原子性；不要引入锁文件或队列这类新机制。
  - 失效端点删除仍以本轮推送实际拿到的 401/404/410 为准；若该 endpoint 在合并时已被
    重新订阅（记录内容发生变化），以磁盘上的新记录为准，不删。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：c51e8aa
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配独立 worktree
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：按 envelope 实际值回填
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收；执行器不得自评通过。

## 修复卡必填

- **root_cause_group**：订阅账本的 read-modify-write 跨越 await，用陈旧快照整体覆盖磁盘。
- **introduced_by_commit**：`pre-existing`（注意力层 v1 引入 `pushToAll` 时即存在，
  执行器须用 `git log -S "writeSubscriptions(deps.stateDir, kept)"` 取证并在报告中写明实际 commit）。
- **open_findings**：
  1. `src/notify/service.ts` `pushToAll`：await 后用旧快照 `kept` 覆盖写，吃掉期间新增订阅。
  2. 同函数内 `sub.lastSuccessAt = now()` 改的是快照对象，语义上依赖上述覆盖写才生效，
     合并写改造后必须显式表达为 delta。

## 修改边界

- **允许**：
  - `src/notify/service.ts`
  - `src/notify/state.ts`（仅在需要新增/调整合并写 helper 时；沿用现有 read/write 原子写语义）
  - `tests/notify-push-delivery.test.ts`
  - `tests/notify-state.test.ts`
  - `tests/notify-service-drain.test.ts`（若回写时序断言受影响）
- **禁止**：
  - `src/controls/**`、`src/client-entry.ts`、`src/pwa/**`（并行卡 B 的范围，改了必冲突）
  - `src/notify/routes.ts`（subscribe 路由已验证正确，不动）
  - `.github/workflows/`
- **Scope-Globs**：src/notify/service.ts src/notify/state.ts tests/notify-push-delivery.test.ts tests/notify-state.test.ts tests/notify-service-drain.test.ts
- **高风险区域**：停机排空（`inFlight`）语义 —— 合并写不得改变「PTY exit → 写 last-session →
  await 在途推送 → server.close()」的既有顺序保证，`tests/notify-service-drain.test.ts` 必须仍绿。

## 不变式轴表

轴：写回时机 × 期间发生的并发写

| 推送结果 | await 期间磁盘变化 | 期望终态 | 检测点 |
|---|---|---|---|
| 全部成功 | 无 | 原有订阅 lastSuccessAt 更新 | 表驱动测试 |
| 全部成功 | 新增 1 条订阅 | 新订阅**保留**，原有 lastSuccessAt 更新 | 表驱动测试（本卡核心回归） |
| 部分 410 失效 | 无 | 失效端点删除，其余保留 | 表驱动测试 |
| 部分 410 失效 | 新增 1 条订阅 | 失效端点删除 + 新订阅保留 | 表驱动测试 |
| 部分 410 失效 | 同一失效端点被重新订阅（记录内容变化） | **不删**（以磁盘新记录为准） | 表驱动测试 |
| 全部失败（非 401/404/410） | 新增 1 条订阅 | 不发生删除，新订阅保留 | 表驱动测试 |
| 无订阅（skipped 路径） | 新增 1 条订阅 | 新订阅保留（不得写空数组） | 表驱动测试 |

并发写的构造方式：通过注入的 `sendPush` stub 在推送 await 期间直接对 stateDir 里的
订阅文件追加一条记录（模拟并发 subscribe 落盘），以此断言合并语义。这是本卡唯一
可信的复现手段，不得用「同进程内直接调函数、无文件写入」的伪并发替代。

降层三问（写进报告）：
1. 终态写入成功之前已发生哪些不可逆动作？（推送已真实发出、通知可能已到达手机）
2. 守卫用的值（endpoint）在实际部署形态下自身唯一吗？
3. 保护覆盖的是「写入」还是「行为」？

## 给执行器的一条要求

如果你认为轴表里某一格的期望值可疑、或与「目标」段的意图矛盾，
**必须在 report.md 里显式提出，不得默默按格实现。提出不算抗命，是本卡要的东西。**

## 完成条件

- **产物入库**：全部落盘产物提交到 delegate 分配的 `card/<worktree 名>` 分支；报告贴出
  `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。
- **行为验收**：在一次推送的 await 期间新增订阅，推送结束后该订阅仍在
  `push-subscriptions.json` 中；即用户「点开关订阅 → 期间有其它事件触发推送」不再丢订阅。
- **相关测试**（全量跑，禁用 `-k` 子集）：
  - `pnpm exec vitest run tests/notify-push-delivery.test.ts tests/notify-state.test.ts tests/notify-service-drain.test.ts`
  - `pnpm test`（全量）
  - `pnpm exec tsc --noEmit`
  - `pnpm run check`
  - `pnpm run lint:knip`
- **跨发布边界不适用**：订阅账本读写在同一进程内，无跨仓/跨 job 发布边界。
- **TDD 要求**：先写出「await 期间新增订阅被吃掉」的失败测试（红），再改实现（绿），
  报告中贴出红→绿两次运行的实际输出片段。
