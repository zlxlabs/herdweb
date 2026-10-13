# H1 5-spec 资源边界 probe（非质量验收）

固定源 `004f70d2b0b173893f7868734eafa33183e6aae7`。只回答
pthread_create / EAGAIN / SIGABRT 是否碰到可观测有限限制。不是
ci-check，不宣称 ready。仓外私有 fixture 只以 sha256 引用。

## 结论

当前真实消费者 systemd unit `LoadState=loaded`（旧 unit
`LoadState=not-found` 上的默认 TasksMax 不能当故障期数据）。leaf-unit
cgroup `pids.max=1024` 是有限上限。

默认一次 5 文件样本：producer 写明「42 tests using 10 workers」，JSON
`workers=10`。采样窗内 leaf-unit `pids.events.max` +39，即该层发生过因
上限失败的 fork/clone。1Hz `pids.current` 峰值 1000（&lt;1024）——峰值采样
未顶格 ≠ 未触顶。同窗 `session-exit.spec.ts` × webkit-iphone 出现
spawn EAGAIN（原指纹之一）。

同一次 11 unexpected 里其余失败未带 EAGAIN / pthread_create / SIGABRT；
keyboard-toggle、target-badge-layout、touch、target-switch 的原线程指纹
本次未复现。禁止把这 11 条或原 57 条归同因。

未证触顶：leaf memory（峰值约 4.9GiB / max 8GiB，oom 类 events delta 0）；
parent-slice `pids.max` 为内核 `max` 无限额且 events.max delta 0；
user-uid-slice `pids.max=126902` 峰值 2675；`RLIMIT_NPROC=192276` 对 uid
nproc 峰值 375；`kernel.threads-max=384553`。uid 线程计数因 `ps` 未带 `-L`
与 nproc 同值，不作线程上限证据；线程观察以 cgroup `pids.current` 为准。
根 cgroup pids/memory 文件不存在 → unavailable，不当 0 / 无限。

低 worker=2 负控一次：producer「42 tests using 2 workers」且 JSON
`workers=2`；指纹 0；40 passed / 2 timedOut（webkit-iphone
target-badge-layout 与 target-switch 的 timeout，非本指纹）。该次
sampler 16 帧后 `systemctl show` 因 Cannot fork 失败，资源时序
incomplete，禁止把后半段或「更绿」说成修了 57。2 失败 ≠ 质量通过。

候选层级：本 delegate unit 的 TasksMax / pids.max=1024（与本执行器同
cgroup）。不改本仓、不改系统限制。下一 owner：delegate 单元限额，不是
herdweb fixture 卡。无故障期 unit 回放，不能断言原 57 当时上限就是 1024。

## 默认样本契约

- 入口：`pnpm run test:pw --` 五个 spec；未传 `--workers`。
- 母集：keyboard-toggle / target-badge-layout / session-exit / touch /
  target-switch × chromium-android + webkit-iphone；visual 未入。
- 真 list（flags 在文件前）=42。默认前的 `--list` 被 pnpm 额外 `--` 吞掉，
  实际误跑了一轮无 JSON 的同五文件（见下）。
- CI / GITHUB_ACTIONS / NODE_ENV：ABSENT。JSON retries 缺省。
- 准备：scratch 钉 H1 + reflink 复制依赖 + `build:dist` 一次 ≠ 原全入口。
- 本次 JSON sha256：`a41731de17e8c6d89f70fc759ab775b3dceea9c421906063267ba144d5c9a751`
- 原全入口 JSON sha256：`a1d4f5721893b0612ced3121c6999148df2f3828ab79d95d32798faecc547b1d`
  （82 expected / 57 unexpected / 13 skipped / 0 flaky，workers 10）母集更大，
  只作指纹对照。

## 时序

- 默认测试窗：2026-10-13T10:37:34Z 起 50.7s；sampler 51 帧
  10:37:32Z–10:38:24Z。指纹时刻 10:37:37Z session-exit EAGAIN。
- 窗前 leaf `pids.events.max` 已是 28（含误跑 list 与本 unit 既有活动，
  不把 28 算进本次 JSON 样本）；窗内 28→67。
- 低并发 JSON sha256：`259cdf478f5df109184a997b65f6f6f636f47689abd6dd24bf82fdf810a0d47d`
- CLI 为 `pnpm exec playwright test --workers=2` 同五文件（`pnpm run
  test:pw -- --workers=2` 会被额外 `--` 吞掉 flag）。
- 低并发已采峰值 977/1024、events.max 仍 67；其后 collector 不可判。

## unknown（保持 unknown）

- 原全入口故障期 unit 限额：无回放。
- 非指纹失败（timeout / browser closed）原因：本卡不答。
- 低并发完整资源曲线：incomplete。
