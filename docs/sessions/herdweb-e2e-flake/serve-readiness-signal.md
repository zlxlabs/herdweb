# serve 等待改就绪信号（herdweb#190）

## 旧判据为什么假红

`waitForHttp` 把「墙钟 10s / Playwright 30s 内 HTTP 200」当成服务已起。tsx 现场编译在 CPU 争用下可以超过这个窗口，子进程仍在跑、stderr 为空，于是报 `still running after 10000ms`。这不是产品崩溃，是「这台机器此刻够快」的假设（同根因见 `docs/sessions/cards/wnet-t3-review1.md`）。

## 新判据

成功：子进程 stdout 出现前缀 `herdweb: serving on `（`src/serve.ts` 在 `waitForServerListening` 之后打印）。失败：等待期间子进程退出（立刻带 exit code 与 stderr 尾，沿用 PR #198）。`Date.now() + hangGuardMs` 只兜真卡死，默认 60s；到期错误必须写明就绪行未出现、进程仍在运行、stdout/stderr 尾。三个 helper 同改，不抽跨文件抽象。`proxy.spec.ts` 的一参调用仍 HTTP 轮询（对端不是 herdweb）。

I2：`booting slowly` 仪表化用例先等 stderr `readable` 再进入 200ms 挂起守卫，不再跟 stderr 投递抢 200ms。

## 挂起守卫为什么留着

就绪行是因果；若子进程既不打印也不退出，测试必须停。60s 不是把 10s 调大后的性能预算。

## 实测

base 红（2026-09-27T01:07:47+08:00，`uptime` load 23.69, 32.19, 27.52；跑完 33.31, 33.59, 28.25）：`FAIL |dom| tests/serve.test.ts > serve document route > does not allow enabled-ASR HTML to be cached` — `Error: timed out waiting for http://127.0.0.1:42113 (process still running after 10000ms)`；`Test Files 1 failed | 1 passed (2)` / `Tests 1 failed | 42 passed (43)`。

修复后绿（2026-09-27T01:28:48+08:00，host-wide 24 busy loop 暖机 40s 后 `uptime` load 21.22, 12.43, 16.10；跑完 23.34, 13.54, 16.39）：`Test Files  2 passed (2)` / `Tests  43 passed (43)` / Duration 16.04s。挂起守卫探针（`sleep 120`、永不打印就绪行、默认 60s）：`elapsed_ms=60002` / `就绪行未出现 (process still running after 60000ms)` / stdout `<no stdout>` / stderr `<no stderr>`。
