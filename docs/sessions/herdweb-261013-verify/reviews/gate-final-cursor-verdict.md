# H4 独立终审（#178 / dlg-20261013-160123-47afa9）

审对象 `1e6619837fa42b1b76ce87049172201fab215ef1..2d37b771eef9d4c7e360579da6a9bfa83ec75ea6`（23 files, +2211/−1）。元树基 main=`1e66198`；代码/tsc/vitest 只在官方 `scratch-worktree.sh` 的 H4 临树。risk-tier=personal。未读生产者报告。
failure-visibility: clean
<!-- delegate-outcome: succeeded -->
## 全量

接线符合 design.md 机制预算：三 caller `@v2`、`scripts/gate-quality` 单入口 prep+`exec mise exec -- pnpm run ci-check`、独立 visual 流水线。未改 `src/`、`ci.yml`、锁文件、主 PW timeout/retries/双浏览器。无新增第二包装器。静默出错表在 touch 文件无命中。

**H1(10be0c8 首实现)→H4 四问：** 只扩入口准备/PATH 密封/上传字节/TS2532；无新抽象；无 fallback/retry；生产薄 `exec pnpm` 被替换而非双路径（测试里 `FAKE_PNPM` 仅用于回归红）。

## 增量

**准备 `004f70d..H4`（3 files, +157/−42）：** 脚本 8 行薄入口→13 行 prep 链（blob `6ef4501`→`6330ff6`）；测试锁 argv/cwd/env/相位退出；design 钉 README 38–53。四问：只修准备责任；无新抽象；无事实源 fallback；无双路径。H3=H4 脚本字节相同（sha256 `5f4d81de…248d`）。

**类型 `b9fade0..H4`（2 files, +3/−3）：** `readBlocks` 将记录块断言为 `[string, string, ...string[]]` 以满足 `noUncheckedIndexedAccess`；design 两行注释合并。四问全否。H3 同命令 tsc 恰两处 TS2532（L382–383）；H4 tsc 0。

## 不变量（代码 / 锁测）

1. 质量定义=本仓 `pnpm run ci-check`。入口：`scripts/gate-quality` L7–13：root→`mise trust --yes ./mise.toml`→`mise install --yes`→frozen deps→chromium+webkit→`exec … pnpm run ci-check`；`set -eu`。测：`declares the repo-owned prep chain`、`each failing phase`。Mise/root/TLS 前置未证，与结构正交。
2. 子进程 producer：`runEntry` PATH 仅 fakebin+可执行 dirname；测 `producer e2e`/`fails loud 127`。独立探针（非复制 FAKE_MISE）H4 blob `6330ff6` 再证。H1 薄脚本拷 H4 测：e2e 期望 0 得 95、phase 期望 17 得 95（代码红，非缺文件）；shebang 对照绿。
3. 三 caller：`tests/gate-onboarding.test.ts` gate/shadow/disposition；禁 `pull_request_target|workflow_run|…`；gate 三 secrets 不含 PWRS；shadow 无 secrets；disposition 八项 `${{ inputs.* }}` + `secrets: inherit`。legacy 跳过由 callee fixture `mode=entry` 锁，本仓不跑第二套。
4. 主 PW `testIgnore` 仅 `**/herdweb-visual.spec.ts`；visual 独立 config、chromium-only（design 走查单浏览器）、真实 `page.goto`。主套件仍 chromium+webkit。未跑主 PW。
5. visual job `if` 同仓非 dependabot / dispatch；report/artifacts 兄弟目录；发布 `steps.upload.outcome == 'success'`；argv 锁 `@cyborgtests/reporter@3.0.0` + template slice sha256 `9b75a98f…`。
6. `UI_EVIDENCE_HEAD_SHA=${{ github.event.pull_request.head.sha || github.sha }}` 上传/发布同表达式。AGENTS 豁免仍在，待 same-head 媒体+primary/quality 真 success。`ci.yml`/src/锁/主 retries/timeout 未动。
7. 无第二安装器。CodeReview 无 finding ≠ consumer 成功。

README API（2/3）：ref `f4213194…` blob `14b56550…` sha256 `e71d6839…` 均匹配；38–53=自有入口含依赖、exit 原样、不重试、可执行后跳过 legacy。fixtures sha256 全与 SOURCE.md 一致。

## 未证 / 阻断（不冒绿）

| 项 | 状态 | 阻断交付？ |
|---|---|---|
| 公开仓 resolve 私有 `ui-evidence-publish`（#801） | 未证 | 阻 UI 验收；源接线在，不升 P1 |
| H3 CI 38418414308 单测/PW 后 TS2532 | H4 本地 tsc 已消；H4 真 CI 未跑 | 不阻本 diff；真 CI 仍 unknown |
| H3 quality 38418414907 `mise: not found`/127 | 探针 no-mise 再现；H3=H4 脚本 | 阻质量验收；属平台前置，非脚本违 spec |
| H3 UI 38418414213 Set up job | 未复验 | 阻 UI |
| 主 PW / 全量 ci-check / TLS#314 | 本卡禁跑 | unknown |
| defaultworkers 1024 kernel 拒 | 已知 | 不抬 limit；不排 fixture#4624 |
| 主干基线 gh api | 派发时失败 | 继承红未能判定 |

H4 真 GitHub CI/UI **unknown**。codeGate 只是单仓守卫，不提成全机 infra。

## OCR

三态 **skipped**（≠ clean）。`ocr-review` 已调（from/to 40SHA、audience=agent、bg 2346B）；stderr 仅 `leg=primary event=start`；子进程 `ocr review` 跑约 10min 后退出；stdout envelope 0B；缓存无含 H4 SHA 的 attendance。未裸调 `ocr` CLI，未把空 findings 当 reviewed。

## 独立探针 / 红验

- Producer H4 blob=`6330ff6a22cdcb40cb9143e5a88fd001defa5a2c` file-sha256=`5f4d81deef2a32fb07a9d5f78f116cc6d815e4a7f30c8345ff9dc07ac78a248d` 同源。
- 裸 env（无 PI_/DELEGATE_）：CI absent calls `8a5e37ac5264…` vs CI=true `4b425a048a03…`（可区分）；相位 17/19/23/27/29 截断；no-mise stderr sha256 `ac5242396847…` 含 `mise: not found`、exit 127。旧 fixture `git_head=80de0eb` 未当 H4 原件。
- 窄验（H4 临树 cwd `scratchpad/vt-ZNASVm`）：vitest 61 passed、`tsc --noEmit` H4 rc0 / H3 rc2 两 TS2532；tsc 5.9.3 直 bin，非 pnpm run。vitest 日志有 ECONNREFUSED :3000 噪声，未改 61 绿。

## 严重度 vs 阻断

无 P1/P2。P3 backlog：`readBlocks` 用元组断言而非运行时长度守卫（fake mise 结构已锁；独立探针不走该解析）。交付：代码审 **不阻断合入本 diff**；整体 #178 验收仍被 UI#801 + quality mise 前置 + 未跑 H4 真 CI **阻断**。不降套件、不绕 TLS、不抬 workers。

## 踩坑

1. 假 mise 若 `#!/usr/bin/env python3` 在密封 PATH 下会 127 假红；改绝对 `/usr/bin/python3` 后才与「无 mise」分轨。
2. `scratch-worktree.sh` 命令结束即拆树；结果必须先写私有 `/tmp`。
3. 元树在 main，缺实现不是「无实现」证据；审读/跑测只用 H4 临树或 `git show`。
4. OCR 包装器与 node CLI 生命周期分离，exit 0/空 stdout 都不能当 reviewed。最贵：OCR 空等 + 临树拷 node_modules。
