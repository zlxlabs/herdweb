# @cyborgtests/reporter@3.0.0 CLI upload HTTP 失败出口

核验对象：真实 npm 包 3.0.0（不是 fake npx exit 17）。本地 `127.0.0.1` 假 HTTP；未打真实 PWRS、未改业务代码。

## 包指纹

- name/version: `@cyborgtests/reporter@3.0.0`
- tarball: `https://registry.npmjs.org/@cyborgtests/reporter/-/reporter-3.0.0.tgz`
- shasum: `79b62bb842f651db294274715dba7af14eb394f7`
- integrity: `sha512-ugg6QL65RsMkJWxtipIFBoR9Wj4OzcFKQ4wpVZkUaPacDWUfmr9rAOEhpSrzFiPvzitnj+kRkub7cDI6r6uExw==`
- tarball sha256: `eea84f34102ac6be6f1ebefe23107592c83305646e2c85c4e2471849f49ec19a`（14685 bytes；`npm pack --ignore-scripts`，与 `npm view dist` 一致）
- bin: `playwright-reporter-cli` → `dist/cli.js`
- `dist/cli.js` sha256: `777c71e021f67f4249703a456d7ddc6f7c880755f66a4403ddfd4bebc2457675`
- `dist/client.js` sha256: `09ccf875f213baec10d225de54855d46f281a2ee3575fa9fe9c39a28a3200f5d`

## H1 冻结 argv（workflow `004f70d2`）

`npx --yes --package=@cyborgtests/reporter@3.0.0 --package=streamx@2.28.1 playwright-reporter-cli upload <reportDir> --url <PWRS_BASE> --token <token> --project … --title … --meta …`

真实 CLI `--help` 旗标：`--url`（必填 endpoint）、`--token`、`--project`、`--title`、`--tags`、`--meta`（可重复）。help stdout sha256 `4a98c3ae7c1c3f3c0d7e0c96bf40604931975cc25bb1ead57e703ec3b33826a7`。

## 源码失败出口（只读 3.0.0 dist，≤3 文件）

- `dist/cli.js` `runUpload`：缺 `--url` 抛 `Missing required --url flag`；成功路径调用 `ReportServerClient.uploadReportZip`。
- `dist/cli.js` `main().catch`：任意拒绝 `process.exit(1)`（约 L146–149）。未知子命令：`process.exitCode = 1`。
- `dist/client.js` `uploadReportZip`：`POST ${baseUrl}/api/report/upload`；`if (!resp.ok) throw`（约 L94–110）。无内建重试循环。

## 真值表（真实 CLI 各跑一次；token=`fake-local-token`；仅 127.0.0.1）

本地 argv 形：`node dist/cli.js upload <dir> --url http://127.0.0.1:<ephemeral> --token fake-local-token --project local-probe --title reporter-cli-http-matrix --meta environment=local-probe`

| 场景 | method/path | bodyBytes | 请求次数 | HTTP | exit | stdout sha256 | stderr sha256 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 2xx | POST `/api/report/upload` | 550 | 1 | 200 | 0 | `6ca2e3eecd9899e257b3c3449a3bb28da7ec14ae4dd215aa47a0061b9afce4bf` | empty `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| 401 | POST `/api/report/upload` | 553 | 1 | 401 | 1 | `e1e9c89640bf7b292a4ec1f0e73d69c258c5c16075291109019e7da25430672f` | `6581d77c682d92ed9dcd1215608c3e7cc660ae1858483daad9d74e7e3b58dd2f` |
| 500 | POST `/api/report/upload` | 553 | 1 | 500 | 1 | `fd6d8503ccf3e4985af39d947e3d02dca352cebdecee9a7b01117d613d88f251` | `fc8974029a9cb66c1613793e56fc2eacf476beac325f7542ace21f168c6bbc65` |

401 stderr 摘要：`[ReportServerClient] Upload failed 401: probe-status-401`。500 同形换状态码。每场景 1 次请求（无 SDK 重试）。403 未单跑，归入 `!resp.ok` 同类。缺 `--url` 负例 exit 1 / `Missing required --url flag`。未知命令 exit 1。

## 对 H1 `steps.upload.outcome` 的含义

库在 HTTP 4xx/5xx 时 **exit 1**，不是静默 exit 0。因此上传步 `id=upload` + `steps.upload.outcome == 'success'` 在 **库进程被默认 `bash -e` 直接收割** 的前提下，可以把 HTTP 红变成 step failure。这是本地假 endpoint 候选，须主脑真环境裁；不自定 P1。mock 2xx 不是 SaaS 成功。失败出口 unknown 已被本次矩阵改写为 **非零已证实**（仅限该假 HTTP）。

## 来源不等价 / 未核

- 调用：`node dist/cli.js` ≠ CI `npx --yes --package=…`（npx 自身 exit 17 仍不是库语义）。
- 服务：`127.0.0.1` 假响应 ≠ 真实 PWRS；200 JSON `{reportUrl,reportId}` 由探针提供，只为走通成功日志。
- 报告：最小 `index.html` ≠ Playwright HTML 产物。
- 未核：timeout/transport、403 单独、npx 包装器、真实域名（未请求，遇真实域名会停）。
