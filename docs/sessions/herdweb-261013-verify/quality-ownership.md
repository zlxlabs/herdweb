# 共享 gate 质量首败与准备契约归属（dlg-20261013-121453-f43fd2）

冻结点：herdweb H1 `004f70d2`（run 38375917087 与普通 CI 38375916366 的共同 headSha）。
callee 实际引用 `zlxlabs/gate/.github/workflows/gate-v2.yml@refs/tags/v2`，在本次共享 run 中解析为
`f4213194`（日志行「Uses: …@refs/tags/v2 (f4213194…)」），与
`tests/fixtures/gate-onboarding/SOURCE.md` 的指纹记录一致；当前 live v2 已前进至 `05389f4`，
不进入本证据链（以 actual run 引用为准）。
原日志：`/tmp/herdweb-261013-bc37e6c6-gate-quality.log`（412070 B，
sha256 `2d6057080f5baf1a6eb16924a0ef1b0fbc49e8dd18065690649424eaaf136c38`），全程只读。

## 判定：首败 = network-only；exit 127 = 安装失败之后果；无 caller-only 证据

首败（日志行 3094，09:31:03Z）：依赖获取在 `registry.npmmirror.com/tunnel/-/tunnel-0.0.6.tgz`
上以 `ERR_PNPM_TARBALL_FETCH_TARBALL` 失败，TLS 层证书错配——`cdn.npmmirror.com` 返回的证书
只对 `*.cdn.myqcloud.com` 等 SAN 有效，客户端在连接阶段拒绝（非超时、非限速触发）。
同 commit 的普通 CI run 38375916366 check job 每步 conclusion=success（checkout → mise →
native 前提 → `pnpm install` → `playwright install --with-deps` → `pnpm run ci-check`，
无 docs-only 跳过），故缺陷不在代码、lockfile 或 caller 仓库的准备定义，而在 shared runner
出口到该 registry 镜像的网络/TLS 路径。

次生（日志行 3161–3164，+120ms）：`sh: 1: vitest: not found` → ELIFECYCLE 127 → step 失败。
node_modules 不完整是安装未完成的直接后果，不是独立根因。

## 三类 cmd 差集（producer 责任 → consumer 证据）

| 需求 | callee f4213194 entry 模式承诺 | caller gate.yml/脚本实发 | 普通 CI check（对照） | 真实执行 |
|---|---|---|---|---|
| checkout | mirror prime + actions/checkout@v4（步骤定义；日志 09:30:48–58 完成） | 无（callee 负责） | actions/checkout@v4 | 成功 |
| Node/pnpm 工具链 | 无安装步骤（self-hosted 预置；无 mise step） | 随仓携带 mise.toml，但不执行 | jdx/mise-action@v3 | 平台预置 pnpm 可用 |
| 依赖安装 | **无承诺**：Install dependencies 仅 legacy 模式（continue-on-error）；run-quality 为单行 `run: ./scripts/gate-quality` | gate-quality = `exec pnpm run ci-check`，不含 install | `pnpm install` | 见下方 unknown |
| 浏览器 | 无 | 无 | `playwright install --with-deps` | 未到达（job 全程约 18 秒） |

关键缺口候选（platform-side，中等置信）：entry 模式下「依赖安装」无任何一方书面承诺——callee 的
install step 被 `if: mode == 'legacy'` 排除；caller 脚本与 package.json 均无 install 钩子
（H1 仓库树无 .npmrc）。而日志显示 install 特征输出（supply-chain 校验 635 条通过、
`Lockfile is up to date`、content-addressable store `/opt/gate-hub-cache/pnpm/v11`）确实出现在
gate-quality step 内部——发起者是 runner 平台预置的 pnpm 包装/配置，其源码不在本卡可见范围
（机制细节 unknown）；且安装失败未阻断后续 ci-check，首败语义被 127 掩盖。

## 两个有依据候选

1. network-only（高置信，首败归属）：registry CDN TLS 证书错配。证据 = 日志 3094–3099 的
   具体域名/SAN 错配正文 + 同 commit 普通 CI 全绿（排除代码与 caller 准备缺陷）。npmmirror
   路由来自 runner 侧镜像配置，非本仓定义。
2. platform-side 契约缺口（次生语义）：entry 模式依赖安装无人承诺 + 失败不 fail-loud，
   红码从网络错误降级为 vitest 127。最小下一步（不跨仓修改，仅建议）：由 gate 平台仓 owner
   裁 entry 模式 install 承诺与失败语义（fail-loud 或显式跳过条件）；herdweb 侧无需改动。

排除项：
- caller-only：无 caller 准备失败证据（普通 CI 同 commit 全绿；caller 不承诺 registry 路由）。
- mixed：顾问 20261013-201155 的 mixed 是未核 callee 与 actual run 前的低置信候选，本次核实后
  不采纳。注意 Tarball 错误码名本身不是网络原因的证明——本卡 network 判定依据是证书错配正文。

## 证据索引

- 日志行：2823（`Run ./scripts/gate-quality` group）、3087（group 结束；其间大段文本为 job 级
  `GATE_SOURCE_*` env 多行值的 step 摘要回显，对应 f4213194 文件 117–250 行）、3094（首败）、
  3161–3164（vitest 127）；时间线 09:30:47Z 起至 09:31:05Z 收尾。
- callee f4213194（`gh api contents?ref=f4213194…`，本卡唯一 callee 网络读取）：run-quality step
  原文见 605–616 行；Install dependencies 651–687 行（legacy-only、continue-on-error）。
- fixture 指纹：`tests/fixtures/gate-onboarding/SOURCE.md`（f4213194 校验于 2026-10-12，
  逐字节切片）。
- 未验证项：runner 预置 pnpm 包装/配置的源码与来源（平台镜像内不可达 → unknown）；
  npmmirror 镜像路由的注入者（runner 全局配置，不可见）。
- 不变量：工作树冻结于 `1e66198`（status 干净）；本卡零业务 diff（base==head==1e66198）；
  原日志 sha256 读取前后一致（本卡无任何写路径指向它）。
