# 固定 H1 本地完整质量验证（不修源码）

quality-verdict: failed — H1 `pnpm run ci-check` exit 1；coverage+build 通过后停在 `test:pw`；PW JSON 完整 152 = 82 expected + 57 unexpected + 13 skipped（log：57 failed / 9 skipped / 4 did not run / 82 passed）；flaky=0；后续 lint/tsc/deploy 因 && 链未跑（unknown-not-run）。CI 变量缺席。母集与失败集均有仓外 JSON/日志 hash。源码未改。

## 冻结

- H1=`004f70d2b0b173893f7868734eafa33183e6aae7`
- H0=`fd4a03b90ea774782727630aa17681e24fbde06d`
- base/main=`1e6619837fa42b1b76ce87049172201fab215ef1`
- 证据树基于 main；被测源只来自 H1/H0 scratch，不在 main 上跑。

## 观测能力

- Playwright 1.58.2 源支持 `PW_TEST_REPORTER`（追加 reporter 模块路径）与 `PLAYWRIGHT_JSON_OUTPUT_FILE`。只改观测，未改 `pnpm run ci-check` argv。
- `--list` 真实写出 JSON（非自造）：`pw-list.json` sha256=`7a864ff036ce2af26cb5736700c7189b0a3347a6f9a5f08bc3aa41b8101eb021` bytes=104265。
- 反向 `--project=__no_such_project__` exit 1（不能把空输出当通过）。正向 `chromium-android` / `webkit-iphone` `--list` 均为 exit 0。
- 母集删末行后 sha256 变化（非恒等判据）。

## 母集

- 152 tests / 2 projects / 20 files / visual spec=0。
- projects：`chromium-android`, `webkit-iphone`（各 76）。
- identity tsv sha256=`480bd756372cc69a72bd15bd2db13fc9bccbf49bac1aad5a10f0b2e51fcb190e`。
- H0 `--list` 解析后同一 152 元组（hash 相同）。stdout 原文 hash 不同是 pnpm 前缀行，不是用例集合不同。

## 环境白名单（消费者）

- Node v22.23.3（mise pin 22；非 login shell）；pnpm 11.28.5；Playwright 1.58.2；tsx 取自 scratch `node_modules/.bin`。
- `CI` / `GITHUB_ACTIONS` / `NODE_ENV`：ABSENT。TMPDIR 短路径（len=4）。
- workers=10（默认 50%，nproc=20）；retries=0（非 CI）。身份变量已剥离。
- 浏览器 dry-run：chromium-1208、webkit-2248 已装。
- 未设 `CI=true`，未改 timeout/retry/workers/skip。

## H1 完整入口一次

- 命令：`pnpm run ci-check`（10 段 `&&`）。exit=1；2100s 硬界未触发；PW duration 182599ms。
- 阶段：`test:coverage` 绿（85 files / 1560 passed + 1 skipped）→ `build:dist` 绿 → `test:pw` 红 → 其后未跑。
- coverage：Statements/Lines 85.81% (10139/11815)。
- PW JSON sha256=`a1d4f5721893b0612ced3121c6999148df2f3828ab79d95d32798faecc547b1d` bytes=371466。
- log sha256=`71482ad579a4e58ee8d96f75d549f4e0120198bcbdde0a91ffa49fa26a281dbc` bytes=149525。
- 实发对母集：152/152 命中，0 extra，0 missing。失败集属于母集，未泛扫。
- JSON status：expected 82 / unexpected 57 / skipped 13 / flaky 0。
- unexpected 按 project：chromium-android 27，webkit-iphone 30（事实，非根因）。
- unexpected 主键 hash=`8047275bbdc3a02b316fcb94c12fa36dc63a83181d4d36392f020554b2b638dd`。
- 错误类计数（报文首行，非根因）：timeout_beforeEach 17, browser_closed 17, timeout_setup_fixture 9, page_crashed 4, webserver_timeout 3, EAGAIN 2, skip_modifier_timeout 1, timeout_60s 1, timeout_30s 1, assertion_expect 1, SIGABRT 1。
- `check` / oxlint / typos / knip / publint / tsc / `test:deploy` = 未启动（`&&` 链 missing-by-construction），不是这些步骤失败。

## H0 对照（同入口，一次，串行）

覆盖范围：同 `pnpm run ci-check` + 同 PW 观测 env + 同工具 pin + 同 152 母集；不是失败子集重跑。不能以交集/单次 A/B 断因果。

- exit=1；PW duration 174155ms。
- vitest：85 files / 1552 passed + 1 skipped（相对 H1 少 8，对应 H1 新增 gate-onboarding 单测，非 PW）。
- coverage 与 H1 相同 85.81% (10139/11815)。
- log：68 failed / 8 skipped / 5 did not run / 71 passed。
- JSON：expected 71 / unexpected 68 / skipped 13 / flaky 0；152/152 母集命中。
- unexpected 主键 hash=`fc610fc0cf9e8301ce1c44a8a3a58270ff82ef836abec5ea6e4ac46aa13c34f7`。
- 相对 H1 unexpected：both 34 / only-H1 23 / only-H0 34。
- JSON sha256=`71fedf4616f599a1d241673969705a5c2337f3bc28425bebb882ba598f1a4b0f`。
- log sha256=`765d52ffad871d082f59702368db683bd8feef5e3f387c692c4f65de2cdf216a`。
- 本对照不能推出「H1 相对 H0 回归」或「竞争」；单次本地集合不稳定。

## 与历史读数

- 本轮母集 152 是 `--list` 实测，不是把历史 152 当规范。
- 旧摘要 62/81 与 52/84/8 与本轮 82/57/13 不是已验证同一集合。
- 真实 CI 形态是 `CI=true` + retries=2 + failOnFlaky；本轮无 CI，不能互充。

## 未知（不是根因）

- timeout / EAGAIN / SIGABRT / page crash / webserver wait 的触发条件。
- log「did not run」与 JSON skipped 的一一映射。
- 负载读数只是描述，不能由 busy 断因。
- 未跑 `CI=true` 形态；未跑第三轮。
- 主干 CI 基线在派发时刻 gh api 失败，继承红未能判定。

## 源与产物

- 变动源清单：空（本卡只新增本文件）。
- 仓外原始：`tmp/herdweb-261013-verify-dlg-20261013-093242-539f40/`（JSON/log/tsv；不入库）。
