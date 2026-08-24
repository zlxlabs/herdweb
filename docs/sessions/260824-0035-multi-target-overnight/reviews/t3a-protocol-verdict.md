# T3a Protocol 2 严格协议审查结论

## 固定范围

- base：`e85a2f08b12f9c34431cd71db7aaed5166c82a06`
- H0：`0ac2fbd50f200c27f08d19d57435fd1623884c49`
- 审查命令均显式使用 base..H0；当前工作树 HEAD 恰好等于 H0，但未以分支最新提交替代固定范围。
- H0 只改 `src/session-protocol.ts` 与 `tests/session-protocol.test.ts`，相对 base 为 415 insertions、14 deletions。
- 未读取实现器 `report.md`，未修改生产代码或测试。

## 审查证据

独立执行：

- `git diff --name-status e85a2f08b12f9c34431cd71db7aaed5166c82a06 0ac2fbd50f`：仅上述两文件。
- `pnpm exec vitest run tests/session-protocol.test.ts`：1 file、16 tests 全绿。
- `pnpm test -- --reporter=dot`：66 files、1017 tests 全绿。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm run check`：172 files，无修复、无错误。
- `pnpm run lint:knip`：通过。
- `pnpm run lint:ox`：0 errors、12 条既有 warnings。
- `git diff --check base H0`：通过；测试后工作树仍干净。
- 直接运行时探针确认：attach/target-status 注入的未知字段不进入结果；嵌套 `exit` 与 `capabilities` 的未知字段也被丢弃。

卡面提供的 H0 证据另包括 `pnpm run build:dist` 通过。PR #73 保持 draft；`gh pr view 73` 显示 CI `check=SUCCESS`、`release=SKIPPED`。Greptile line/top-level comments 均为 0。

规格出处：

- protocol 2 消息契约与 64 UTF-8 bytes、完整 `TargetSummary`：`/home/zlx/.gstack/projects/zlxlabs-herdweb/ceo-plans/2026-08-23-multi-target-console.md:114-154`。
- target ID/name、8 项上限：同文件 `:178-185`。
- T3a 交付与验证要求：同文件 `:755-758`。
- allowlist、单一 `/ws`、禁止旧协议兼容分支和新增无消费者抽象：`docs/sessions/260824-0035-multi-target-overnight/HANDOFF.md:31-46`。

## 不变式核对

- 三种新增 client control 与八种新增 server control 的字段、discriminator、固定枚举均在 `src/session-protocol.ts:1-168` 定义；解析分支在 `:274-327`、`:341-399`，测试覆盖在 `tests/session-protocol.test.ts:116-175`。
- request/session/attachment/action/ping ID 的非空与 UTF-8 上限统一由 `isProtocolId`（`src/session-protocol.ts:184-190`）执行；target ID 正则在 `:192-194`。旧 heartbeat 的 `id` 合同保持有效，未引入第二套 ping/pong wire。
- attach 的 cols/rows 复用正整数与 `500×200` 上限，代码在 `:174-175`、`:371-385`；测试在 `tests/session-protocol.test.ts:215-248` 覆盖 0、浮点、字符串、上限和超限。
- targets 强制 1–8、ID 唯一在 `src/session-protocol.ts:278-289`；测试覆盖空数组、9 项、重复 ID、8 项边界（`tests/session-protocol.test.ts:194-212`）。name 按 Unicode code points ≤80 且拒绝 `Cc` 控制字符（`src/session-protocol.ts:196-203`）；timestamp/summary exit 使用整数校验（`:229-258`），测试覆盖非法名称、控制字符、负 timestamp 与小数 exit。
- 所有成功 parser 结果均逐字段重建：request/attachment helper 在 `:261-272`，TargetSummary 在 `:229-258`，各 control 在 `:274-327`；未知字段不会进入路由结果。
- 精确 JSON serializer 测试覆盖 attach-target、server-ready、完整 targets：`tests/session-protocol.test.ts:132-152`。
- 旧 terminal parser 仍保留在同一 unified parser 中（`src/session-protocol.ts:409-470`），没有 legacy/protocol2 fallback、重试或兼容分支；T3a 未误把尚无 attachmentId 的 terminal frame 当成缺陷。

## OCR 候选复核

| 工具标注 | 本仓判定 | P1 问一：真实自用路径可触发？ | P1 问二：触发后果是数据丢失、静默错误或崩溃？ |
| --- | --- | --- | --- |
| action ID 上限 128 改为统一 64，疑似兼容收缩 | 误报。规格明确统一 64；仓内实际 action ID 为 UUID，远低于上限 | 否，现有实际 ID 不接近 64 bytes | 否 |
| TargetSummary optional spread 未来加字段可能漏 allowlist | 误报。当前实现 destructure 后逐字段重建 summary、exit、capabilities；未知字段探针已确认被丢弃 | 否 | 否 |
| 三个字段/type helper 是单消费者抽象 | 误报。`parseTargetSummary` 同时服务 targets/status，request/attachment helpers 分别服务多个 server control；ProtocolMessage/type aliases 也有多个类型消费者 | 否 | 否 |

## Findings

### P1：0

未发现个人自用路径可触发的数据丢失、静默错误或崩溃。

### P2：0

未发现需要在本轮阻断 T3a 的协议正确性或维护性问题。

### P3：0

未发现仅属低风险但需要记录的真实问题。

## 熵增与红验

熵增审查结论：新增 `TargetRequestFields`、`AttachmentFields`、`ProtocolMessage`、`parseTargetSummary`、`parseTargetRequestFields`、`parseAttachmentFields` 均有多个实际类型或解析消费者；没有新增 fallback、retry、兼容层、schema/map 中间层或无第二消费者状态。

红验抽查（不落盘破坏生产代码）：

1. `tests/session-protocol.test.ts:132-137` 同时锁定 attach-target 精确字节和未知字段丢弃。若将 parser 改为直接返回输入对象，`ignored` 会进入结果，`toEqual(messages[0])` 会红；若改动 serializer 字段顺序或遗漏字段，精确字符串断言会红。
2. `tests/session-protocol.test.ts:145-152` 与 `:194-212` 锁定 ready/targets/status allowlist、完整 targets 字节、1–8/唯一 ID、summary 字段校验。若 `parseTargetSummary` 改为 spread 输入，status 的未知字段断言会红；若移除数量或唯一性 guard，空数组、9 项或重复 ID 的断言会红。

## 最终结论

**PASS**。本轮无新增 P1，满足 personal risk-tier 收敛条件；P1/P2/P3 均为 0。PR #73 保持 draft，不标 ready，不修代码。
