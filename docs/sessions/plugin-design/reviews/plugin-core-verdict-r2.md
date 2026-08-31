# herdr plugin 核心实现第 2 轮评审

## Verdict

**PASS（无新增 P1，可合；带 P2/P3 backlog）。** `f32d328` 已修复第 1 轮的锁生命周期 P1；本轮并发时序复验没有再发现会导致双服务、静默错误或崩溃的 P1。按本仓 internal/infra 评审纪律，P2/P3 可以由主脑接受不修后合入，但本轮是“连续无新增 P1”的第 1 轮，尚未单独满足两轮收敛计数。

- **Outcome：completed。** 本次执行器任务已完成；该值与 review verdict 正交。
- **审查对象（H0 冻结）：**
  - 增量：`eb77b2c1982993f60fd006f5f38992e87ebbe594..f32d328dd0a86db2890c8ffb36c619e52705b8f9`
  - 全量：`910481395f7fc63a4a40e78acc0d562a89a09091..f32d328dd0a86db2890c8ffb36c619e52705b8f9`
- **本轮新证据：** `f32d328` 是首轮结论之后才产生的新代码，且实际把锁的持有者从 runner 改成服务子进程；另有独立 OFD 的 Python/Perl 互斥探针、f32 测试实跑和两条红验。OCR 前置工具只返回 `leg=primary event=start`，约 2 分 30 秒没有 envelope，已停止并记录为未完成，未把它当作“扫过且干净”。

## H0..H1 增量专项审

### 1. 是否只修登记在案的 findings：通过

增量的生产代码变化都能对应首轮的 1 P1 + 4 P2：

- `serve.mjs:173-182` 把锁 fd 传给真实 herdweb 子进程，并把 owner pid 改为 child pid，对应锁生命周期 P1；
- `check-prereqs.mjs:30-42,54-97` 使前置检查覆盖 runner 实际需要的 Python/Perl flock 能力，对应 macOS 运行时依赖 P2；
- `serve.mjs:117-130` 对已有只读锁文件尝试 `r` 打开，对应只读锁文件 P2；
- `serve.mjs:46-51` 对显式非法端口 fail-loud，对应非法环境值静默回退 P2；
- `tests/plugin-ledger.test.ts:65-204,269-289,341-396,438-489` 是上述生命周期和三条 P2 回归测试所需的进程、端口和清理支撑。

没有发现与登记 findings 无关的生产行为、配置或功能夹带。`trackedPids`/`trackedPorts` 仅存在于测试清理路径，不是新的运行时账本。

### 2. 是否新增未经批准的抽象：通过

`ownerPayload` 被 runner 和 child 两个调用点消费；`openLockFile` 把“新建/可写打开”和“已有只读文件”两种必要权限语义隔离；`flockNonblocking` 封装了平台能力路径。它们都直接服务于已登记问题，没有引入面向未来的接口、配置层或中间件。

### 3. 是否无依据增加状态、事实源或 fallback：通过，且保留一条首轮未完事项

运行时事实源仍是同一把 `HERDR_PLUGIN_STATE_DIR/herdweb.lock` 和同一个 `owner.json`；新增的 runner/child 两次 owner 写入是进程交接，不是第三套事实源。Python → Perl 是对 runner 硬依赖的能力探测；显式非法 `HERDWEB_PLUGIN_PORT` 的旧 fallback 已删除。首轮“端口从生效配置读取、不能硬编码 7681”的问题**没有完全修复**：`serve.mjs:48` 仍在环境变量缺失时返回 7681，见下方 `P2-R1-PORT`。

### 4. 是否留下双路径：flock 双实现通过；owner 双写留下可见时序窗口

`FLOCK_PY` 与 `FLOCK_PL` 都对 fd 3 使用 `LOCK_EX|LOCK_NB`；Perl 的 `open(FH, "<&=3")` 绑定继承的同一 fd/open file description。实际用两个独立进程各自打开同一路径并置 fd 3 实测：

```text
python-holder-acquired
python_holder_perl_contender_status=2
perl-holder-acquired
python-contender-blocked
perl_holder_python_contender_status=2
```

因此在“一个进程 Python 持锁、另一个进程 Perl 尝试”和反向组合下，竞争者都确定性失败；这是能力探测，不是把 `LOCK_HELD` 错误吞掉的 fallback。初次探针曾错误地让两个进程继承同一 OFD，双方成功；发现后已改为各自独立 `open`，上面的结果才是本结论依据。

## 全量复验：并发时序与资源生命周期

### 并发启动窗口

`acquireLock()` 在 `serve.mjs:133-145` 先创建/打开并非阻塞取锁；第二个 runner 在第一 runner 持有 fd 的整个阶段都会在 `reportLockHeld()` 退出，不能写配置、owner 或 spawn child。普通情况下顺序是：第一 runner 写自己的 owner（`203-210`）→ spawn child（`176-180`）→ 写 child owner（`181-182`）。

两次 owner 写入使用临时文件再 rename（`99-104`），读方不会读到半个 JSON，但会读到以下中间态：

1. **取锁后、第一次写 owner 前：** 读方可能看到旧 owner 或没有 owner；锁仍是唯一互斥事实源，不能把旧 owner 当成当前服务。
2. **第一次写完、spawn 前：** owner 暂时指向仍在运行的 runner，但实际还没有监听；`show`/`doctor` 若在此刻读取，会看到“owner 存在、listen 尚未成立”。
3. **spawn 成功、第二次写 owner 前：** child 已继承锁 fd，可能已经 bind，但 owner 仍指向 runner。若此时 runner 被杀，child 会继续持锁并提供服务，而 owner 留下死 runner pid；后来者仍会被锁挡住，`ownerIsTrusted()` 会把该元数据判为不可信并输出 `LOCK_HELD (owner metadata untrusted)`，不会把死 pid 报成正在运行的 herdweb。

这不破坏互斥，但使 owner 在崩溃窗口内不能准确表达实际服务进程，属于下方 `P2-NEW-OWNER`。

### 锁与服务的对应关系

- **spawn 失败：** 第一次 owner 已写但没有 child；runner `fail()` 退出，runner fd 由内核关闭，锁释放；旧 owner 会短暂残留，下一次成功启动会覆盖它。
- **child 启动后立即退出：** 第二次 owner 可能短暂记录 child；`exit` 监听器随后让 runner 退出，runner 与 child 的 fd 都关闭，锁释放；不会留下持锁的无服务进程。
- **child 被单独 kill、runner 仍活着：** child 的 `exit` 回调调用 `process.exit`，在回调执行前 runner fd 仍持有锁；退出后才释放，因而不会让 successor 与已死服务并行启动。
- **runner 被单独 `SIGKILL`：** child 继承 fd 3，child 仍监听且继续持锁；successor 只能得到 `LOCK_HELD`。新增 `INV-SVC` 实测正是验证这条路径。

因此本轮没有发现 P1 级的锁/服务脱钩；f32 的 fd 继承修复成立。

## Findings

### [P2-NEW-OWNER] owner.json 的 runner→child 两阶段发布有崩溃中间态

**代码证据：** `scripts/plugin/serve.mjs:203-211` 先写 `ownerPayload(process.pid, ...)`，`runHerdweb()` 在 `176-182` spawn 后才覆写为 child pid。`spawn` 到第二次 `writeOwner` 之间没有握手或 child ready barrier。

**违反的 spec / 不变式：** §2.8 要求 owner.json 是 `{pid,...}` 的服务账本，`show`/`doctor` 以 owner.json + 实际 listen 为事实源；§2.8 的启动顺序要求获锁后无条件覆写 owner 再 bind；§3.3 要求 runner 的服务边界可被可靠报告。

**触发与后果：** 若 runner 在 child 已继承 fd、甚至已 bind 后于 `writeOwner(child)` 前崩溃，child 继续持有锁并服务，但 owner.json 仍记录死 runner。后来者不会双开，却只能得到 `LOCK_HELD (owner metadata untrusted)`；未来 `show`/`doctor` 会看到“有监听但 owner pid 不可信”的中间态，不能准确报告服务身份。若第一次写后、spawn 前崩溃，则 owner 记录无服务的 runner。

**级别判定：** P2。互斥和服务不会双开，错误可见且不涉及数据损坏；问题限于故障窗口的资源账本准确性。建议后续用 child-ready/owner 发布握手收窄该窗口，或明确让 child 在 owner 发布前不 bind。

### [P2-R1-PORT] 首轮端口事实源问题未完全修复（非本轮新增）

**代码证据：** `scripts/plugin/serve.mjs:46-51` 仍然在 `HERDWEB_PLUGIN_PORT` 缺失时 `return 7681`；只有显式非法值改为 fail-loud。

**违反的 spec / 不变式：** §2.8 明确要求端口“从生效配置读取，**不硬编码 7681**”，并要求 owner 记录实际值。

**级别判定：** P2，沿用首轮登记，不计入本轮新增 P1。新增的 P2-3 红验证明非法值回退确实已被修掉，但不能证明缺失值的事实源问题已经解决。

### [P3-TEST-CLEANUP] 测试清理失败被静默吞掉

**代码证据：** `tests/plugin-ledger.test.ts:150-174` 的 `killPidsOnPort()` 在 `ss` 失败时直接 return，`afterEach` 对 `waitListening(..., false)` 使用 `.catch(() => undefined)`；没有最终“所有 tracked port 已释放”的强断言。

**违反的 spec / 不变式：** §2.8/§3.3 的资源账本与服务生命周期要求测试必须能证明服务终态；评审测试纪律要求跨进程终态落在真实 listener 上，而不是只清理直接 runner。

**级别判定：** P3。当前 Linux 实测 `ss` 存在，且 `allocPort()` 会跳过仍占用的端口，所以没有证据表明本套顺序测试会因此误绿；但在缺少 `ss` 或杀进程失败时，测试仍可绿着结束并留下孤儿 listener，污染本机后续运行。建议清理失败时 fail-loud，并用已追踪 pid/端口做终态断言。

## 测试约束力与红验留痕

在独立临时 worktree（H1=f32）执行：

```text
CI=true pnpm exec vitest run tests/plugin-ledger.test.ts
Test Files  1 passed (1)
Tests       8 passed (8)
```

抽查 1：把 `serve.mjs:179` 的 `{ cwd: pluginRoot, stdio: ['inherit', 'inherit', 'pipe', lockFd] }` 注入改为 `... 'pipe', 'ignore' ...`。先用 `nl` 确认注入后的目标行；执行 `INV-SVC SIGKILL runner must not yield two live listeners` 后变红：

```text
× INV-SVC ... 8206ms
Error: timed out waiting for serve exit: LISTENING 17739
Tests 1 failed | 7 skipped
```

这证明 `INV-SVC` 会触达锁继承/接班行为，不是恒真测试。已还原，并重新跑全 8 条全绿。

抽查 2：把 `serve.mjs:50` 的 `fail(1, ...)` 注入改为 `return 7681`。先用 `nl` 确认实际变为：

```text
50  if (port === undefined) return 7681
```

执行 `P2-3 illegal HERDWEB_PLUGIN_PORT fails loud instead of falling back` 后变红：

```text
AssertionError: expected 3 to be 1
tests/plugin-ledger.test.ts:486:23
Tests 1 failed | 7 skipped
```

这证明非法端口测试确实约束了“禁止静默回退”。两次注入均只发生在临时 worktree，均已还原；当前仓库没有实现/测试改动。

## 收敛与合入判断

- **本轮新增 P1：没有。** 这是本轮收敛计数的明确输入。
- 首轮 P1 的核心修复已由真实 f32 测试和 `INV-SVC` 红验锁死；Python/Perl 跨实现也已在独立 OFD 下实测互斥成立。
- 仍有一个首轮 P2（端口缺失时硬编码）未修正，并新增 owner 两阶段发布 P2、测试清理 P3。按纪律可将它们记录 backlog 后合入；若本批要求严格实现 §2.8 的事实源契约，则应先修 `P2-R1-PORT`，而不应把它误报为新 P1。

## 我认为这份实现里最可能出事的一件事

runner 在 child 已继承锁并可能开始监听后，于第二次 owner.json 写入前被杀，留下“服务还活着但 owner 指向死 runner”的账本中间态。
