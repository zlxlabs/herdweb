# herdr plugin 核心实现评审

## Verdict

- **Verdict：FAIL，不建议合入。** 有 1 条 P1；至少应先修复 runner 与 herdweb 子进程之间的锁生命周期断裂。
- **Outcome：completed。** 本次执行器任务已完成；该值与上面的 review verdict 正交。
- **审查对象（H0 冻结）：** `910481395f7fc63a4a40e78acc0d562a89a09091..eb77b2c1982993f60fd006f5f38992e87ebbe594`
- **范围：** `herdr-plugin.toml`、`scripts/plugin/check-prereqs.mjs`、`scripts/plugin/open-pane.mjs`、`scripts/plugin/serve.mjs`、`tests/plugin-ledger.test.ts`。
- **变更量：** 5 个文件，628 行新增，超过任务卡的 400 行 hard budget。该项是流程事实，不作为下面的代码 finding 单独计数。

## Findings

### [P1] 锁只覆盖 runner，不覆盖它拉起的 herdweb 子进程

**代码证据：** `scripts/plugin/serve.mjs:147-150` 以 `spawn` 拉起子进程，stdio 只传递标准输入、标准输出和标准错误，没有把锁 fd 传给子进程；`scripts/plugin/serve.mjs:193-199` 只在 runner 退出时关闭 runner 自己的 `lockFd`。

```text
147  const child = spawn(
148    process.execPath,
149    [cliPath, 'serve', '--config', configPath, '--port', String(port)],
150    { cwd: pluginRoot, stdio: ['inherit', 'inherit', 'pipe'] },
...
193  process.on('exit', () => {
194    try {
195      closeSync(lockFd)
```

**违反的 spec / 不变式：** 违反设计 §2.8 的 user × plugin id 单例行为，以及 §3.3 要求 runner `exec node dist/cli.mjs serve` 的边界契约。L1 本身没有被 unlink 破坏，L2 的“后来者能获锁并覆写 owner”也成立，但这两条只证明账本锁和写入，不证明“同一时刻只有一个 herdweb 在服务”。这正是锁保护“写入”与保护“行为”之间的缝。

**触发条件：** runner 已写完 owner 并启动 child 后，runner 被 `SIGKILL`。内核会关闭 runner 的锁 fd，于是后来者立即获锁；由于 child 没有持有 fd，也没有由 runner 死亡自动终止，它仍继续监听。如果后来者拿到不同的 `HERDWEB_PLUGIN_PORT`，就会同时启动第二个服务；同端口时则会留下旧孤儿并让后来者得到 `PORT_OCCUPIED`。

**独立降层实测：** 使用同一份 `serve.mjs` 和等价的 TCP stub child，第一 runner 在 17880 监听；强杀 runner 后 child 仍为 alive 且 17880 仍 listening；第二 runner 用同一 state 目录、不同端口 17881 获锁并监听。最终两端口同时存在，owner.json 只记录第二 runner：

```text
first runner=3131929 child=3132131 owner=... "port": 17880 ...
after runner SIGKILL: runner_alive=no child_alive=yes port1=listening
successor runner=3132893 child=3133000 owner=... "port": 17881 ...
both_ports=127.0.0.1:17881 127.0.0.1:17880
```

**后果：** 账本丢失第一个实际服务的身份和端口，`show` / `doctor` 后续只能看到 successor；两个 terminal-control endpoint 可以同时存活。默认端口下则会出现无法自愈的孤儿占端口，服务重启或再次打开都会失败。该结果属于失败路径的静默资源账本错误，满足本次提档后的 P1 关注面。

**建议方向：** 让真正执行 herdweb 的进程成为锁生命周期的持有者，保留设计 §3.3 的 `exec` 语义并验证锁 fd 在 exec 边界仍然存活；或者建立明确的进程组监管契约，保证 runner 被强杀时 child 不会继续提供服务。无论选哪条，回归测试都必须断言 parent 被强杀后 child 已终止，且 successor 不能与旧 child 并存。

---

### [P2] macOS 前置检查放过了 runner 必需的 `python3`

**代码证据：** `scripts/plugin/check-prereqs.mjs:46-51` 只在 Linux 检查工具链，并在 macOS 直接报告成功；但 `scripts/plugin/serve.mjs:115-121` 在所有平台都用 `python3` 执行 flock helper。

```text
46  const checkToolchain = process.platform === 'linux'
47  const missing = checkToolchain ? missingToolchain() : []
49  if (!nodeTooOld && missing.length === 0) {
51    console.log(`herdweb plugin prerequisites ok ...`)
...
115 const result = spawnSync('python3', ['-c', FLOCK_PY], ...)
121 fail(1, 'ERROR python3 is required to take flock')
```

**违反的 spec：** 设计 §2.9 将 service 与 pane 定为同一个 runner，manifest 又声明支持 macOS；§2.12 只说明 macOS 不需要 node-pty 的本地编译工具链，并没有取消 runner 的 Python 运行时依赖。

**触发条件：** 支持的 macOS 环境没有 `python3`，这是不能假定系统自带 Python 的平台形态。构建第一步会成功，用户打开 pane 或 service 时 runner 才失败。

**实测证据：** 将 `process.platform` 设为 `darwin` 并把 PATH 置为空时，检查脚本退出 0；同样没有 `python3` 的 runner 退出 1：

```text
herdweb plugin prerequisites ok (node v24.14.0)
simulated_macos_prereq_exit=0
ERROR python3 is required to take flock
simulated_macos_runtime_exit=1
```

**后果：** 安装阶段显示成功，实际启动失败；这不是缺少 node-pty 编译工具，而是 runner 自己的硬依赖漏检。错误最终会显示，但用户已经完成了错误的安装判断。

**建议方向：** 要么把 Python 作为所有声明平台的 runner 前置依赖并在输出中说明，要么移除跨平台 runner 对 Python flock helper 的运行时依赖。检查条件必须与运行时真正执行的依赖一致。

---

### [P2] 已存在的只读锁文件无法按 spec 获取 flock

**代码证据：** `scripts/plugin/serve.mjs:108-113` 使用 `openSync(lockPath, 'a+')`，这要求对已经存在的锁文件有写权限；代码还没有在打开失败时尝试只读打开。

```text
108 const lockPath = join(stateDir, LOCK_NAME)
111   fd = openSync(lockPath, 'a+')
113   fail(1, `ERROR cannot open lock file: ...`)
```

**违反的 spec：** 设计 §2.8 的边界条件明确区分：只读目录应 fail-loud，但只读的既有锁文件本身仍可 flock，不是问题。

**触发条件：** `herdweb.lock` 已存在且权限为 0444，state 目录本身仍可访问。此时 Linux 的 flock 可以在只读 fd 上执行，但 runner 在到达 flock 前就因 `EACCES` 退出。

**实测证据：**

```text
ERROR cannot open lock file: EACCES: permission denied, open '/tmp/herdweb-readonly-lock-state.../herdweb.lock'
readonly_lock_runner_exit=1 mode=444
```

**后果：** 锁文件没有损坏、也没有互斥冲突，但服务仍无法启动；这使权限只收紧到锁文件的合法状态退化成启动失败。

**建议方向：** 保留“目录不可创建时 fail-loud”，同时让已存在的锁文件在只读权限下仍能进入非阻塞 flock 路径；创建新锁文件与打开已有锁文件应按不同权限语义处理。

---

### [P2] 端口事实源没有按 spec 从生效配置解析，非法环境值还会静默回退

**代码证据：** `scripts/plugin/serve.mjs:43-47` 只读取未在 manifest 中声明的 `HERDWEB_PLUGIN_PORT`，缺失或非法时硬编码 7681；`scripts/plugin/serve.mjs:184-190` 和 `147-150` 随后把这个解析结果分别写入 owner 和传给 child。

```text
43  function resolvePort() {
44    const fromEnv = parsePort(process.env.HERDWEB_PLUGIN_PORT)
45    if (fromEnv !== undefined) return fromEnv
46    // herdweb config schema has no `port` field (strict); CLI default is ...
47    return 7681
...
184 writeOwner(stateDir, {
188   port,
...
149 [cliPath, 'serve', '--config', configPath, '--port', String(port)],
```

**违反的 spec：** 设计 §2.8 要求端口“从生效配置读取，不硬编码 7681”，§2.8 启动顺序和 §3.3 runner 职责也都要求从生效配置解析端口。

**触发条件：** pane 或 service 没有注入 `HERDWEB_PLUGIN_PORT`，或者注入值是 `0`、非数字、超范围等非法值。代码不会拒绝错误配置，而是选择 7681。

**后果：** 当前实现内部写入 owner 和 child argv 使用同一个 `port` 变量，所以不存在“owner 记录一个端口、child bind 另一个端口”的直接分叉；这一点通过代码可证实。但它可能在错误端口监听，或错误地撞上现有的 7681 服务，且用户看不到端口配置被忽略的原因。该 fallback 也让未来 config、pane、service 三种来源的端口契约无法统一。

**建议方向：** 选择一个明确的生效端口来源，确保 owner、child argv 和实际配置都从该来源得到同一经过校验的值；非法显式输入应 fail-loud，不应静默改成默认端口。

---

### [P2] L2 测试只验证 owner 覆写，没有验证 successor 真正服务，也没有清理 child

**代码证据：** `tests/plugin-ledger.test.ts:258-269` 强杀的是 `first.pid`，随后只等待第二个 runner 写 owner；`tests/plugin-ledger.test.ts:62-78` 的 afterEach 只记录并杀直接 spawn 的 runner，不追踪 runner 的 child。

```text
258 process.kill(first.pid, 'SIGKILL')
...
262 const second = spawnServe(env)
264 const owner2 = await waitForOwnerPid(stateDir, second.pid)
265 expect(owner2.pid).toBe(second.pid)
...
269 })
```

**违反的 spec / 不变式：** 设计 §2.8 的单例行为和 §3.3 的 runner 边界要求服务生命周期也受 runner 契约约束；L2 不能只被解释成“JSON 被新 runner 覆写”。

**触发条件：** 每次 L2 用例强杀 runner 后，旧 child 都可能继续监听；第二个 runner 使用同一端口时，其 child 会在 bind 阶段失败，但测试在 owner 写入后就结束，不检查 child 是否 listening、是否退出，也不检查旧 child 是否终止。

**后果：** 测试可以在“owner2 写成功、successor child 实际没起来”的状态下变绿，并把临时 plugin 根目录删除后留下仍在监听的孤儿进程，污染后续测试和本机端口。它没有真正锁死 L2 所宣称的故障语义。

**建议方向：** 测试应保存 runner 与实际 child 的进程身份，分别断言强杀 parent 后 child 的终态，以及 successor 的 bind/监听终态；清理必须覆盖整个进程树，且测试结束后确认目标临时端口已释放。

## P3

无。没有把纯风格、未来功能缺席或与 spec 无关的意见列为 P3。

## 降层审查：三问

### 1. 终态写入成功之前已经发生了什么不可逆动作？失败留下什么？

按 `scripts/plugin/serve.mjs` 的实际顺序：

1. `acquireLock()` 的 `mkdirSync(stateDir, { recursive: true })`（104）创建 state 目录；`openSync(lockPath, 'a+')`（111）创建或打开锁文件。锁文件按 L1 设计故意不删除，因此失败后会留下空的 `herdweb.lock`。
2. 已获锁后，`ensureConfig()` 的 `mkdirSync(configDir, { recursive: true })`（131）和缺失时的 `writeFileSync(configPath, DEFAULT_CONFIG)`（136）会留下配置目录和默认配置。
3. `writeOwner()` 先写 `${target}.tmp`（98）再 `renameSync` 到 owner.json（99）。如果后续 child bind 失败，当前 runner 仍会退出，但没有删除 owner.json；它会留下带死 runner PID 的 stale owner，下一次获锁时再被覆盖。
4. `runHerdweb()` 在 147-150 启动 child。child 可能已经产生外部可见的监听，也可能在 bind 失败后退出。runner 被强杀时，child 不一定退出，这是 P1 的残留。

这些动作中，state 目录和锁文件是设计允许的持久账本；默认配置是预期的引导文件；stale owner 在 SIGKILL 后是允许的报告残留。不可接受的是 child 脱离账本继续提供服务，因为 owner.json 已经不能代表所有活跃服务。

### 2. 守卫用的值在实际部署形态下自身唯一吗？

- 互斥域是 `HERDR_PLUGIN_STATE_DIR/herdweb.lock`（176、108），代码信任 herdr 注入的绝对路径，不把 plugin id 自己拼入路径。根据 runtime probe，**同一 user 的多个 named herdr session** 获得相同的 plugin state 目录时，锁域正确共享；reinstall 换 `HERDR_PLUGIN_ROOT`（178）时 state 路径仍可保持相同，因此 checkout 更换不会天然绕过锁。
- 这个唯一性依赖 herdr 传入的 state 路径。不同容器若没有共享同一底层 state 目录，各自的文件和 flock 域彼此独立，会各自获锁；不同 PID namespace 中的同一个数值 PID 也不能作为全局身份。这里的 PID + starttime（50-61、73-84）只是拿不到锁时的诊断值，不是互斥事实源，因此 namespace 差异会首先表现为“owner 不可信”，不会修复或破坏 flock 本身。
- 在同一用户、同一 plugin id、herdr 正常注入共享 state 目录的声明部署形态下，路径是足够的；代码没有额外验证路径是否真属于该 plugin。这是既有环境契约，不另列为 finding。P1 的问题在于即便这个路径唯一，child 仍能在 runner 锁释放后脱离它。

### 3. 保护覆盖的是写入还是行为？中间有没有缝？

保护覆盖了 runner 持有的 `lockFd` 和 owner.json 写入：`writeOwner()` 在拿到 flock 后执行，runner 退出时关闭 fd。它没有覆盖 child 的服务行为：child 没有继承 lock fd，且父进程收到 SIGKILL 时没有机会执行转发。P1 的实测正是这条缝：owner 被 successor 覆写，但旧 child 仍然监听。

## 三条实现声称锁死的不变式

| 不变式 | 结论 | 证据 |
|---|---|---|
| L1：锁文件永不 unlink | **当前实现路径成立** | `serve.mjs` 没有对 lock 做 unlink；L1 用例同时运行两个 runner，第二个得到退出码 2；红验把 lock 失败伪装成功后在 `plugin-ledger.test.ts:241` 变红。 |
| L2：SIGKILL 后后来者获锁并无条件覆写 owner | **账本层成立，行为层未锁死** | 代码在 184-191 无条件写 owner；目标测试通过 4/4，L2 用例验证 successor PID 覆写。但它不验证旧 child 已死，且独立降层证明旧 child 可继续监听。 |
| L3：LOCK_HELD 与 PORT_OCCUPIED 分开 | **在当前 herdweb 错误文案下成立，但依赖 stderr 文本协议** | lock 失败固定走 2；child stderr 含 `EADDRINUSE` 或 `already in use` 时走 3。目标测试 4/4 通过，立即退出的 `EADDRINUSE` stub 重复 20 次均为退出码 3。若未来 child 改变文案或改写 stdout，`isAddrInUse()` 会返回 false，代码退化为 child 原始退出码（通常 1），而不是 `PORT_OCCUPIED`。 |

因此，本轮认为**没有哪条 L1/L2/L3 在字面锁路径上完全失效**；真正没有被锁死的是这些不变式想保护的“单一实际服务行为”。尤其 L2 测试把 owner 覆写误当成了服务接管完成。

## 重点专项核查

### 锁机制与平台

Linux 和 macOS 都走 `python3` 的 `fcntl.flock(3, LOCK_EX | LOCK_NB)`（22-23、115-126），并把同一个打开文件描述符映射到 helper 的 fd 3。Linux 测试实际证明了非阻塞成功、锁竞争退出和 fd 保持路径；macOS 的 `fcntl.flock` 机制本身没有在本轮本机实测，且 macOS 前置漏检 Python 已作为 P2 列出。构建检查的 Linux `python3` / `make` / `c++` 或 `g++` 与 node-pty 的 Linux 编译依赖一致，但它没有覆盖 runner 在 macOS 的 Python 依赖。

### 端口事实源与 `PORT_OCCUPIED`

owner 的 `port` 和 child argv 都来自同一个局部 `port`，因此当前代码内部没有 owner/bind 端口分叉；真正的问题是该值的来源违反 §2.8，且非法 env 被静默回退。`PORT_OCCUPIED` 依赖 child stderr 中的 `EADDRINUSE` 或 `already in use`；当前 `src/serve.ts:151-155` 对 `EADDRINUSE` 生成含 `already in use` 的 Error，runner 的 stderr listener（153-156）能看到它。L3 测试和 20 次立即退出 stub 抽查均通过，因此本轮不把“未来文案变化”单独升级为 finding。

### 子进程、信号与 fd 生命周期

正常 SIGINT/SIGTERM 路径中，157-161 会把信号转发给 child，child 正常退出后 162-169 传递退出码；端口占用时按 3 退出。问题只在 parent 被 SIGKILL、child 没有 fd / process-group 监管，或者 child spawn 失败时的生命周期边界。父 runner 的 exit handler 能关闭自己的 fd，但无法回收已脱离的 child。

### 前置检查输出上限

在 Linux 三项工具全部缺失时，实际输出为 10 行，正好达到上限；缺失组合最多也只会产生同样 10 行，不会超过上限。Node 过旧且工具缺失的分支更短。没有发现“超出后截掉关键行”的当前缺陷。

### manifest 正确性

`herdr-plugin.toml` 的 id、版本、最低 herdr 版本、平台和 build 顺序与设计一致；没有声明 `[[startup]]`、rescue target 或主动 `0.0.0.0` 入口。当前只声明了实际存在的 `serve` pane 和 `start` action：`scripts/plugin/serve.mjs`、`scripts/plugin/open-pane.mjs` 均存在。`show`、`doctor`、`install-service` 缺席符合本卡非目标，不是 finding。

## 红验抽查记录

基线测试在固定 H0 内容的临时 checkout 中通过：

```text
CI=true pnpm exec vitest run tests/plugin-ledger.test.ts
✓ tests/plugin-ledger.test.ts (4 tests)
Test Files  1 passed (1)
Tests       4 passed (4)
```

第一次直接在临时 checkout 使用无终端的 pnpm exec 被 pnpm 的模块目录清理保护拦截，报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，没有把它当成测试结果；设置 `CI=true` 后按指定命令成功执行。

### L3 端口分类

临时把 `scripts/plugin/serve.mjs:141` 改为：

```text
return false // RED-VERIFY: break PORT_OCCUPIED classification
```

先用 `sed` 留痕确认注入生效：

```text
function isAddrInUse(text) {
    return false // RED-VERIFY: break PORT_OCCUPIED classification
}
```

再运行同一测试文件，L3 变红：

```text
× L3 LOCK_HELD and PORT_OCCUPIED are distinct exit codes and prefixes
AssertionError: expected 1 to be 3
tests/plugin-ledger.test.ts:298:26
```

### L1 锁竞争分类

还原后临时把 `scripts/plugin/serve.mjs:125` 改为：

```text
if (result.status === 2) return fd // RED-VERIFY: pretend lock acquisition succeeded
```

用 `sed` 确认注入生效：

```text
if (result.status === 2) return fd // RED-VERIFY: pretend lock acquisition succeeded
```

运行只筛选 L1 用例，断言变红：

```text
× L1 serve.mjs never unlinks the lock; a second process cannot acquire it
AssertionError: expected 3 to be 2
tests/plugin-ledger.test.ts:241:23
```

两次注入均在临时 checkout 完成并还原；还原后的完整测试再次为 4/4。当前评审工作树没有留下这些注入。

## 熵增审查

无可另列的 P3 熵增意见。新增的 `serve.mjs` 不是无消费者的通用抽象：它承载锁账本，并按设计同时服务 pane 与后续 service 两个边界；`open-pane.mjs` 是 manifest action 到 herdr pane 的进程边界适配器，负责使用 `HERDR_BIN_PATH`，不是重复镜像状态；owner、mode、port 是 spec 明确要求的账本字段/运行形态，而不是现有状态的无必要副本。端口 fallback 的问题已按真实配置错误列为 P2，不重复算作熵增。

## 初筛与验证状态

- `ocr-review` 已启动，但主腿约 5 分钟没有返回最终 envelope；中断时只出现本地复核子进程未回收的错误，没有可核验的 OCR findings。本报告没有把空结果当作“扫过且干净”。
- 图谱扫描在固定提交的临时导出目录完成代码结构索引；文档语义抽取因无 API key 被工具拒绝，随后使用 code-only 模式完成。它只用于调用关系导航，不改变本 verdict。
- 语法检查、manifest 入口文件存在性检查、`git diff --check` 均通过。

## 我认为这份实现里最可能出事的一件事

**runner 被强杀后，锁释放但它拉起的 herdweb 子进程继续监听，后来的 runner 覆写 owner.json 并可能在另一端口启动，造成账本只记录一半实际服务。**
