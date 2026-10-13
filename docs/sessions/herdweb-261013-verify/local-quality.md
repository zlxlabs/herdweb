# 固定 H1 本地完整质量验证（不修源码）

quality-verdict: failed — H1 `pnpm run ci-check` exit 1；coverage+build 通过后停在 `test:pw`；PW JSON 完整 152 = 82 expected + 57 unexpected + 13 skipped（log：57 failed / 9 skipped / 4 did not run / 82 passed）；flaky=0；后续 lint/tsc/deploy 因 && 链未跑（unknown-not-run）。CI 变量缺席。母集与失败集均有仓外 JSON/日志 hash。源码未改。Counter 对账正向空差集、三负控均红（补证；不改变质量 verdict）。

## 冻结

- H1=`004f70d2b0b173893f7868734eafa33183e6aae7`
- H0=`fd4a03b90ea774782727630aa17681e24fbde06d`
- base/main=`1e6619837fa42b1b76ce87049172201fab215ef1`
- 证据树基于 main；被测源只来自 H1/H0 scratch，不在 main 上跑。原 producer JSON/log/tsv hash 未改、未自造新 consumer JSON。

## 观测能力

- Playwright 1.58.2 源支持 `PW_TEST_REPORTER`（追加 reporter 模块路径）与 `PLAYWRIGHT_JSON_OUTPUT_FILE`。只改观测，未改 `pnpm run ci-check` argv。
- `--list` 真实写出 JSON：`pw-list.json` sha256=`7a864ff036ce2af26cb5736700c7189b0a3347a6f9a5f08bc3aa41b8101eb021` bytes=104265。
- 反向 `--project=__no_such_project__` exit 1。正向两 project `--list` 均为 exit 0。

## 母集与 Counter 对账（补证）

身份：`(project, file, location, describe全链+title)`。母集来自原 `--list` stdout，与 `mother-set.tsv` 逐行相等；实发来自原 `pw-ci-check.json` 152 元组。判据是 Counter 相等（空差集），**不是**文件 hash 不同。

- 母集 152 / 2 projects / 20 files / visual=0。tsv sha256=`480bd756372cc69a72bd15bd2db13fc9bccbf49bac1aad5a10f0b2e51fcb190e`。
- 正向：mother Counter == actual Counter；152/152；missing=0 extra=0 multi=0；判据 rc=0。
- 负控1 只删母集 1 行（实际 152 不动）：rc=1 failed；extra_count=1（被删身份仍在实发）。
- 负控2 只重复母集 1 行（实际不动）：rc=1 failed；mother 该键 2 vs actual 1。
- 负控3 实发空集合（母集 152 不动）：rc=1 failed；missing_count=152。
- 未同时删两腿。三负控均非零/failed，判据会变红。
- H0 `--list` 解析后同一 152 元组。stdout 原文 hash 不同是 pnpm 前缀，不是用例集合不同。

## 环境白名单（消费者）

- Node v22.23.3（mise pin 22；非 login shell）；pnpm 11.28.5；Playwright 1.58.2；tsx 取自 scratch `node_modules/.bin`。
- `CI` / `GITHUB_ACTIONS` / `NODE_ENV`：ABSENT。TMPDIR 短路径（len=4）。
- workers=10（默认 50%，nproc=20）；retries=0（非 CI）。身份变量已剥离。
- 浏览器 dry-run：chromium-1208、webkit-2248 已装。未设 `CI=true`，未改 timeout/retry/workers/skip。
- 故障期 PATH 记录缺：driver 有 `export PATH="$PWD/node_modules/.bin:$PATH"`，但 whitelist 脚本 `int((:+PATH)+：).find(...)` 在写出 `PATH_has_nm_bin` 前抛 ValueError；已保存的 `ci-check-env-whitelist.txt`（15 行/649B）无 PATH 行。不以现在 probe 冒充当时值。

## H1 完整入口一次

- 命令：`pnpm run ci-check`（10 段 `&&`）。exit=1；2100s 硬界未触发；PW duration 182599ms。
- 阶段：`test:coverage` 绿（85 files / 1560 passed + 1 skipped）→ `build:dist` 绿 → `test:pw` 红 → 其后未跑。
- coverage：Statements/Lines 85.81% (10139/11815)。
- PW JSON sha256=`a1d4f5721893b0612ced3121c6999148df2f3828ab79d95d32798faecc547b1d` bytes=371466。
- log sha256=`71482ad579a4e58ee8d96f75d549f4e0120198bcbdde0a91ffa49fa26a281dbc` bytes=149525。
- JSON status：expected 82 / unexpected 57 / skipped 13 / flaky 0。
- unexpected 按 project：chromium-android 27，webkit-iphone 30（事实，非根因）。
- unexpected 主键 hash=`8047275bbdc3a02b316fcb94c12fa36dc63a83181d4d36392f020554b2b638dd`。
- 错误类计数（报文首行，非根因）：timeout_beforeEach 17, browser_closed 17, timeout_setup_fixture 9, page_crashed 4, webserver_timeout 3, EAGAIN 2, skip_modifier_timeout 1, timeout_60s 1, timeout_30s 1, assertion_expect 1, SIGABRT 1。
- `check` / oxlint / typos / knip / publint / tsc / `test:deploy` = 未启动（`&&` 链 missing-by-construction）。

## log 9 skipped / 4 did not run（JSON 字段索引，未重跑）

JSON skipped=13，全部 `n_results=1` 且 `result_statuses=['skipped']`。按 `expectedStatus`+annotation 可切开，与 log 9+4 计数一致：

- 9 条 `expectedStatus=skipped` 且 annotation `type=skip`（有意 skip）：webkit asr×5（`full voice flow is chromium-only`）、chromium asr 240:2（`capability degradation is webkit-only`）、webkit dpad 107:1（clipboard）、webkit notify×2（Web Push chromium-only）。
- 4 条 `expectedStatus=passed`、annotation 空、`status=skipped`：chromium asr 162:2 / 194:2 / 214:2、chromium target-switch 93:2。对应 log「4 did not run」的可索引集合；不是 test.skip 修饰符。

## H0 对照（同入口，一次，串行）

覆盖范围：同 `pnpm run ci-check` + 同 PW 观测 env + 同工具 pin + 同 152 母集；不是失败子集重跑。串行、不同时窗；同工具/设置 ≠ 资源等价；墙钟相近（PW 182599ms vs 174155ms）不能当负载/CPU 等价。不能以交集/单次 A/B 断因果。

- exit=1。vitest：85 files / 1552 passed + 1 skipped（相对 H1 少 8，对应 H1 新增 gate-onboarding 单测，非 PW）。
- coverage 与 H1 相同 85.81% (10139/11815)。
- log：68 failed / 8 skipped / 5 did not run / 71 passed。
- JSON：expected 71 / unexpected 68 / skipped 13 / flaky 0。
- unexpected 主键 hash=`fc610fc0cf9e8301ce1c44a8a3a58270ff82ef836abec5ea6e4ac46aa13c34f7`。
- 相对 H1 unexpected：both 34 / only-H1 23 / only-H0 34。
- JSON sha256=`71fedf4616f599a1d241673969705a5c2337f3bc28425bebb882ba598f1a4b0f`。
- log sha256=`765d52ffad871d082f59702368db683bd8feef5e3f387c692c4f65de2cdf216a`。
- 本对照不能推出「H1 相对 H0 回归」或「竞争」。

## 与历史读数

- 本轮母集 152 是 `--list` 实测，不是把历史 152 当规范。
- 旧摘要 62/81 与 52/84/8 与本轮 82/57/13 不是已验证同一集合。
- 真实 CI 形态是 `CI=true` + retries=2 + failOnFlaky；本轮无 CI，不能互充。

## 未知（不是根因）

- timeout / EAGAIN / SIGABRT / page crash / webserver wait 的触发条件。
- 负载读数只是描述，不能由 busy 断因。
- 未跑 `CI=true` 形态；未跑第三轮；本补证未重跑任何测试。
- 主干 CI 基线在派发时刻 gh api 失败，继承红未能判定。

## 源与产物

- 变动源清单：空（只改本元证据文件）。
- 仓外原始：`tmp/herdweb-261013-verify-dlg-20261013-093242-539f40/`（JSON/log/tsv；不入库）。
