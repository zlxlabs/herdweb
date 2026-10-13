# 共享 gate 质量首败与准备契约归属（dlg-20261013-121453-f43fd2）

冻结点：herdweb H1 `004f70d2`（run 38375917087 与普通 CI 38375916366 的共同 headSha）。
callee 实际引用 `zlxlabs/gate/.github/workflows/gate-v2.yml@refs/tags/v2`，在本次共享 run 中解析为
`f4213194`（日志行「Uses: …@refs/tags/v2 (f4213194…)」），与
`tests/fixtures/gate-onboarding/SOURCE.md` 的指纹记录一致；当前 live v2 已前进至 `05389f4`，
不进入本证据链（以 actual run 引用为准）。
原日志：`/tmp/herdweb-261013-bc37e6c6-gate-quality.log`（412070 B，
sha256 `2d6057080f5baf1a6eb16924a0ef1b0fbc49e8dd18065690649424eaaf136c38`），全程只读。

## 判定：已证 TLS 身份错误与 vitest 缺失；network-only / caller-only 均未证

首败（日志行 3094，09:31:03Z）：依赖获取在 `registry.npmmirror.com/tunnel/-/tunnel-0.0.6.tgz`
上以 `ERR_PNPM_TARBALL_FETCH_TARBALL` 失败，TLS 层证书错配——`cdn.npmmirror.com` 返回的证书
只对 `*.cdn.myqcloud.com` 等 SAN 有效，客户端在连接阶段拒绝（非超时、非限速触发）。
同 commit 的普通 CI run 38375916366 check job 每步 conclusion=success（checkout → mise →
native 前提 → `pnpm install` → `playwright install --with-deps` → `pnpm run ci-check`，
无 docs-only 跳过）。该绿仅反证同源在已准备环境可运行，不排除共享入口缺准备，也不排除
caller-only。TLS 首败与准备责任另列。客户端主机名验证失败不能断 CDN 错证还是
路由/proxy/DNS/客户端因素，故不能把整段失败叫 network-only。

次生（日志行 3161–3164，+120ms）：`sh: 1: vitest: not found` → ELIFECYCLE 127 → step 失败。
node_modules 不完整是安装未完成的直接后果，不是独立根因。

## 三类 cmd 差集（producer 责任 → consumer 证据）

| 需求 | callee f4213194 entry 模式承诺 | caller gate.yml/脚本实发 | 普通 CI check（对照） | 真实执行 |
|---|---|---|---|---|
| checkout | mirror prime + actions/checkout@v4（步骤定义；日志 09:30:48–58 完成） | 无（callee 负责） | actions/checkout@v4 | 成功 |
| Node/pnpm 工具链 | 该版本实现无安装步骤（无 mise step；正式契约 unknown） | 随仓携带 mise.toml，但不执行 | jdx/mise-action@v3 | 日志见 pnpm（发起者 unknown） |
| 依赖安装 | 该版本实现无此 step（正式契约 unknown）：Install dependencies 仅 legacy 模式（continue-on-error）；run-quality 为单行 `run: ./scripts/gate-quality` | gate-quality = `exec pnpm run ci-check`，不含 install | `pnpm install` | 见下方 unknown |
| 浏览器 | 无（conditional） | 无 | `playwright install --with-deps` | 未到达（日志窗 ≈18s；官方 job 09:30:44Z–09:31:26Z） |

关键缺口（unknown，缺 producer 证据）：该版本实现无 entry 安装 step ≠ 正式契约未承诺。callee 的
install step 被 `if: mode == 'legacy'` 排除；caller 脚本与 package.json 均无 install 钩子
（H1 树无 .npmrc；workspace 无 verifyDepsBeforeRun/registry；无 packageManager）。
而日志显示 install 特征输出（supply-chain 校验 635 条通过、`Lockfile is up to date`、
store `/opt/gate-hub-cache/pnpm/v11`）出现在 gate-quality step 内部——发起者 unknown
（谁触发 install / 是否默认 verify-deps 无证据，不兜猜 wrapper）；失败未阻断，127 掩盖首败语义。

## 两个有依据候选

1. TLS 身份错误（已证观察，归属 conditional）：registry CDN 证书主机名验证失败。证据 = 日志
   3094–3099 的具体域名/SAN 错配正文。普通 CI 全绿不排除共享入口准备缺口，也不能定为
   全部 network-only。npmmirror 路由来自 runner 侧镜像配置，非本仓定义。
2. 准备契约（conditional / unknown）：该版本实现无 entry 安装 step + 失败不 fail-loud，
   不等于正式契约未承诺，不能预定责任给 caller/platform。最小下一步（不跨仓修改，仅建议）：
   由 gate 平台仓 owner 裁 entry 模式 install 书面承诺与失败语义；herdweb 侧无需改动。

排除项：
- caller-only：撤原「CI 全绿因此排除」。无独立 caller 准备失败证据，也无证据排除 → unknown。
- mixed：顾问 20261013-201155 的 mixed 是未核 callee 与 actual run 前的低置信候选，本次核实后
  不采纳。注意 Tarball 错误码名本身不是网络原因的证明——本卡 TLS 观察依据是证书错配正文。

## 证据索引

- 日志行：2823（`Run ./scripts/gate-quality` group）、3087（group 结束；其间大段文本为 job 级
  `GATE_SOURCE_*` env 多行值的 step 摘要回显，对应 f4213194 文件 117–250 行）、3094（首败）、
  3161–3164（vitest 127）；日志时间线 09:30:47Z–09:31:05Z（或为 step 窗，非官方 job 全程 09:30:44Z–09:31:26Z）。
- callee f4213194（`gh api contents?ref=f4213194…`，本卡唯一 callee 网络读取）：run-quality step
  原文见 605–616 行；Install dependencies 651–687 行（legacy-only、continue-on-error）。
- fixture 指纹：`tests/fixtures/gate-onboarding/SOURCE.md`（f4213194 校验于 2026-10-12，
  逐字节切片）。
- 未验证项：谁触发 install；runner 是否默认 verify-deps；正式准备契约；CDN 错证 vs
  路由/proxy/DNS/客户端。本机 pnpm 11.7.0 的 verify-deps-before-run=undefined，无同版本模块。
- 不变量：仅改本元文件，零业务源码；原日志 sha256 读取前后一致（无写路径指向它）。
  工作树基线 `dd67227`（原元提交）；H1 业务源仍为 `004f70d2`，本卡不改。
