# herdr plugin 运行时 × 单实例账本探针矩阵

环境：Linux 6.8 + systemd user + herdr 0.8.2。探针只绑 `127.0.0.1`，端口 17681–17685。
复现：`bash docs/sessions/plugin-design/probes/run-all.sh`（自带清理）。原始输出在 `/tmp/herdweb-probe-runtime/evidence/`。
macOS：本卡未测；A2 的 `/proc` 判据在文内给出等价手段。

## 结论

**资源账本契约可行**，但草案 §2.8 有三处必须改，否则会在真实故障路径上再次错误归因。

1. **互斥本身成立。** 非阻塞 `flock` 第二个进程确定性失败（exit 42 / `LOCK_HELD`）。两个 herdr named session 共用同一把 `HERDR_PLUGIN_STATE_DIR` 锁：s1 `try-serve` 拿到锁并 `LISTENING`，s2 在 **plugin log** 里是 `LOCK_HELD pid=… mode=pane port=17682`、exit 2。账本作用域是 **user × plugin id**，不是 session。
2. **A2 陈旧 owner.json 不是正确性缺口，是报告缺口。** `SIGKILL` 后内核立刻释放 flock（后来者 `try-lock acquired=true`），`owner.json` 残留且 `/proc/<pid>` 不存在 → `stale_dead_pid`。**拿到锁本身就证明 owner.json 可无条件覆盖**；`/proc/<pid>` + `starttime`（macOS：`ps -p PID -o lstart=`）只用于「拿不到锁时把残留元数据说成谁在跑」这条报告路径。草案把「退出时清理 owner.json」写成正确性条件，SIGKILL 做不到，应改成「获锁后无条件覆写」。
3. **B5 端口归因走得通。** 无关 `python3 -m http.server` 占 17681 时，探针拿到锁、bind 失败，措辞为 `PORT_OCCUPIED port=17681 (got the lock; occupant is not this ledger)`，不会冒充「已有 herdweb」。
4. **最大缺口（正确性）是锁文件 inode 被删。** 持锁进程仍握 fd 时 `unlink` 锁文件（tmpfs 清空的用户态等价），后来者对同路径 `open` 得到新 inode 并再获锁 → `double_holder=yes`。§2.8 必须写死：锁文件永不 unlink，fd 持有到进程退出；`STATE_DIR` 不要放可被周期性清空的 tmpfs。
5. **systemd `Restart=on-failure` 必然有锁空窗。** `RestartSec=1` + 持锁 0.4s 时，空窗约 1.1s（`free_at`/`held_at` 交替）。空窗里另一条 runner（pane action）可以抢走锁。§2.9 要写明这个窗口，不要假装 service 重启期间互斥连续。

两个 runner 同源（§2.9）**可行**：unit `Environment=` 注入的 `HERDR_PLUGIN_*` 出现在进程 `printenv` 里。

## 设计需要改的地方

| 草案条款 | 实测 | 应改 |
|---|---|---|
| §2.8 启动顺序「退出时清理 owner.json」 | SIGKILL 后文件残留，但 flock 已释放 | 获锁后无条件覆写；清理只是礼貌。报告路径才用 pid+starttime |
| §2.8 未提锁文件生命周期 | `unlink` 后双持有 | 禁止 unlink 锁文件；doctor 可查 inode 是否仍被持锁 fd 打开 |
| §2.8 「同一 user 同一 network namespace」 | config/state 目录跨 session **相同**；socket 不同 | 作用域写成 **user × plugin id**（XDG state 目录）。namespace 只影响 bind，不是锁的事实源 |
| §2.8 冲突归因只分两类 | 成立，B5/B6 都对 | 保留。事实源是锁，不是端口（B6：不同端口仍 `LOCK_HELD`） |
| §2.9 `Restart=on-failure` | 空窗 ≈ RestartSec + 拉起耗时 | 写明空窗；不要用 Restart 当互斥延续 |
| §2.9 卸载三件套 | 缺 `reset-failed` 时 `list-units --all` 仍见 `not-found failed` | 四件套：disable --now + rm unit + daemon-reload + reset-failed |
| §2.9 stale doctor | 删 checkout 后再 start → `status=203/EXEC` | doctor：`ExecStart` 路径不存在 **或** `ExecMainStatus==203` |
| §3.3 / action 当错误通道 | `plugin action invoke` **恒 EXIT 0**，`status=running`；失败只在 **该 session** 的 `plugin log list` | action 只能当触发器。失败必须写进 pane/popup，不能指望 CLI 或默认 session 的 log |
| 卡面「已知」`herdr --session 新名字` 自动拉 server | **仅 TUI 入口**。`plugin action invoke` 报 `server_not_running` | 文档写清：CLI 子命令不拉 server；无 tty 时 TUI 客户端 panic，但 server 仍起来 |
| §2.8 macOS | 未测 | Linux：`/proc/<pid>/stat` 字段 22。macOS：`kill -0 PID` + `ps -p PID -o lstart=`（无 `/proc`） |

---

## A. flock 单实例账本

### A1 两个非阻塞 flock

命令：`flock -n -E 42 lock -c 'sleep 4' &` 然后第二个 `flock -n -E 42 lock -c 'echo unexpected-acquired'`。

输出：`second_exit=42`，`holder_exit=0`，第二个未打印 `unexpected-acquired`。

结论：第二个**确定性失败**。Linux `flock` 可用。macOS 待测（BSD `flock` 语义通常相同）。

### A2 SIGKILL 与陈旧 owner.json

命令：`serve.py serve` 写 owner.json → `kill -KILL` → `diagnose` + `try-lock`。

持锁时 diagnose：`"verdict": "live"`，`current_starttime` 与记录一致。

SIGKILL 后：

```
proc exists? no
try-lock: {"acquired": true, "pid": …}
diagnose: "verdict": "stale_dead_pid"
```

`owner.json` 仍含死 pid。获锁成功。

结论：锁会自动释放。陈旧判据：

- **已获锁** → 一律视为陈旧，覆写。不必读 `/proc`。
- **未获锁** → 读 owner.json：`/proc/<pid>` 在且 starttime 一致 → 报「谁在跑」；否则报「锁被持有但 owner 不可信」，不要把死 pid 说成 herdweb 还在。

macOS：无 `/proc`。用 `kill -0 $pid` 判存活，`ps -p $pid -o lstart=` 当启动时间。PID 复用时 lstart 对不上。待测。

### A3 目录缺失 / 只读 / 锁文件被删

| 条件 | 命令要点 | 输出 | 结论 |
|---|---|---|---|
| 目录不存在 | `open('/tmp/does-not-exist-…/herdweb.lock')` | `FileNotFoundError [Errno 2]` | runner 必须 `mkdir -p STATE_DIR`，草案未写 |
| 锁文件 `chmod a-w`（已存在） | `flock -n` | `acquired` / exit 0 | 只读**文件**仍可 flock（RDONLY open） |
| 目录 `chmod 555`、锁不存在 | `open(dir/herdweb.lock,'a+')` | `PermissionError [Errno 13]`；`flock_exit=66` | 只读**目录**无法创建锁 → 启动应 fail-loud |
| 持锁后 `unlink` 锁文件 | 同路径再 open+flock | `double_holder=yes old_inode=1381674 new_inode=1381675` | **正确性漏洞**。tmpfs 清空同理 |

### A4 两个 named session

进程级（同锁不同端口）：第二个 `LOCK_HELD pid=… port=17682`，`second_exit=2`。

真实 plugin action（s1 先 `try-serve`，1s 后 s2）：

- s1 log：`status=succeeded` `stdout` 含 `LISTENING` `port=17682`
- s2 log：`status=failed` `exit_code=2` `stderr=LOCK_HELD pid=3941011 mode=pane port=17682 (another herdweb is running)`

结论：锁拦住跨 session 的第二次启动。invoke 的 CLI 两边都是 EXIT 0（见 D14），互斥结果只在 **各 session 自己的 log**。

---

## B. 端口归因

### B5 拿到锁但 bind 失败

命令：`python3 -m http.server 17681 --bind 127.0.0.1` 然后 `serve.py --port 17681 serve`。

```
LISTEN … 127.0.0.1:17681 … users:(("python3",pid=…))
PORT_OCCUPIED port=17681 (got the lock; occupant is not this ledger): [Errno 98] Address already in use
serve_exit=3
```

结论：路径走通。正确措辞是「端口被非本账本进程占用」，不是「已有 herdweb」。

### B6 不同端口、同一把锁

第一个 `--port 17682` `LISTENING`；第二个 `--port 17683` → `LOCK_HELD … port=17682`，`second_exit=2`。

结论：账本事实源是**锁**不是端口。配置不同端口不能开第二个实例——这正是单例想要的。

---

## C. systemd user service

### C7 `Environment=` 是否注入

unit 在 `~/.config/systemd/user/herdweb-probe-runtime.service`。`enable --now` 后 `is-active=active`。

`systemctl --user show -p Environment` 含全部 `HERDR_PLUGIN_*`。进程写出的 `printenv.log`：

```
HERDR_PLUGIN_CONFIG_DIR=/tmp/herdweb-probe-runtime/svc/config
HERDR_PLUGIN_ID=probe.runtime
HERDR_PLUGIN_ROOT=/tmp/herdweb-probe-runtime/svc
HERDR_PLUGIN_STATE_DIR=/tmp/herdweb-probe-runtime/state/svc
HERDWEB_PROBE_PORT=17684
```

结论：快照写入 `Environment=` 能让 service 与 pane 共用路径。PATH 未测定制（本机 user unit 继承 user manager 环境）。

### C8 `Restart=on-failure`

unit：`Restart=on-failure` `RestartSec=1`，脚本持锁 0.4s 后 exit 1。

journal：`Scheduled restart job` 间隔约 1s。`restarts.log` 每 ~1.4s 一行。锁采样：`free` 约 0.4s / `held` 约 1.1s 交替。

结论：重启延迟 ≈ `RestartSec`。空窗 ≈ `RestartSec` + 新进程再次 flock 之前。端口同样空。pane 在此窗口可抢锁。

### C9 linger

`loginctl show-user zlx`：`Linger=yes`。

**未测成**：关掉 linger 或 `loginctl terminate-user` 会拆掉本机 user systemd，连带 default herdr 与 7681 上的 herdweb。

应当怎么测（独立测试用户，不要在这台工作机）：建用户 U → `loginctl enable-linger U` → 以 U 装 unit → `loginctl terminate-user U` → `systemctl --user -M U@ is-active …`。对照再测 linger=no。macOS 对应 `launchd` `LimitLoadToSessionType`，本卡未测。

### C10 stale checkout

删 `WorkingDirectory`/`ExecStart` 后再 `start`：

```
Active: failed (Result: exit-code)
Process: … ExecStart=…/run.sh (code=exited, status=203/EXEC)
ExecMainStatus=203
```

doctor：路径不存在 **或** `ExecMainStatus==203` → stale。不要只看 `Active=failed`（别的失败也会 failed）。

### C11 卸载

`disable --now` + 删 unit + `daemon-reload` + `reset-failed` 后：`0 loaded units`、`unit files: none`、`UNIT_NAME_ABSENT=yes`。缺 `reset-failed` 时曾留下 `not-found failed` 幽灵。

---

## D. herdr plugin 运行时

### D12 临时 plugin

`herdr plugin link /tmp/…/plugin`（**不要** `link --enabled PATH`：`--enabled` 会把 PATH 当选项值，报 `unknown option`）。link 后已 enabled。

manifest 含 `[[actions]]` 与 `[[panes]] placement=popup width=80 height=12`。`plugin list`：`probe.runtime … enabled [local:…]`。`config-dir`：`~/.config/herdr/plugins/config/probe.runtime`。

### D13 两个 named session 的 env

`plugin action invoke` **不**自动拉 server，报 `server_not_running`。无 tty 跑 `timeout 3 herdr --session NAME </dev/null`：客户端 ratatui panic（`No such device or address`），**server 仍 running**。

| 变量 | default | s1 / s2 |
|---|---|---|
| `HERDR_BIN_PATH` | `/home/zlx/.local/bin/herdr` | 同 |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | `…/sessions/<name>/herdr.sock` |
| `HERDR_SESSION` | （default 未出现） | `probe-runtime-s1` / `s2` |
| `HERDR_PLUGIN_CONFIG_DIR` | `~/.config/herdr/plugins/config/probe.runtime` | **同** |
| `HERDR_PLUGIN_STATE_DIR` | `~/.local/state/herdr/plugins/probe.runtime` | **同** |
| `HERDR_WORKSPACE_ID` / `TAB_ID` | 该 server 当前聚焦（本次 default 为 `wG` / `wG:t5`） | 各 server 自己的 `w1` / `w1:t1` |

结论：config/state **跨 session 共享** → 一把锁管全 user。socket/workspace/tab **按 session**。invoke JSON 的 `context` 已带 workspace/tab；env 里另有同名变量。

### D14 stdout/stderr 与失败可见性

`herdr plugin action invoke fail-now`：**EXIT 0**，`log.status=running`，**不回显**脚本的 stdout/stderr。

同一失败在 **该 session** 的 `plugin log list`：`status=failed` `exit_code=7` `stderr=fail-now stderr: boom` `stdout=fail-now stdout: …`。

`plugin log list` **不带 `--session` 只打 default server**。s1 的失败在 `herdr --session s1 plugin log list`。

TUI toast：**未测成**（探针 session 无客户端附着）。CLI 已证明 invoke 不是 fail-loud。action 不能当用户可见报错通道。

### D15 无活动 workspace

新 named session **自动有一个 workspace**（`workspace list` → `w1` label=probe-runtime，cwd=启动时的目录）。「零 workspace」未造出。

裸终端、不带 `--session` 的 invoke 打到 **default 当前聚焦**（本次 `wG`），不是「无 workspace」。

要测真·无 workspace：需 herdr 支持空 session 或不自动建 workspace——0.8.2 未找到办法。**未测成 + 原因：新 server 必带 w1。**

### D16 popup 开在哪个 session

`herdr --session s1 plugin pane open --entrypoint hold --no-focus` → `{"type":"ok"}`。

pane 进程 env：`HERDR_SESSION=probe-runtime-s1`，`HERDR_SOCKET_PATH=…/probe-runtime-s1/herdr.sock`，有 `HERDR_PLUGIN_ENTRYPOINT_ID=hold`，**无 `HERDR_PANE_ID`**。

`herdr --session s1 pane list` 只有原来的 zsh pane，没有 popup——与文档「popup 不是 Herdr pane」一致。

结论：popup 开在 **触发它的 `--session`**，不是 default 里当前聚焦的那个。

---

## 环境已复原

跑完 `run-all.sh` 后：

- `systemctl --user list-units --all 'herdweb-probe-*'` → 0 units；`~/.config/systemd/user/herdweb-probe-*` 不存在
- `herdr plugin list` → No plugins installed；`probe.runtime` 的 config/state 目录已删
- `herdr session list`：无 `probe-runtime-s1/s2`。预先存在的 stopped session（`__herdweb_plugin_popup_probe__` 等）未动
- `herdr --session default` pid **1820136** 始终未变；`127.0.0.1:7681` 仍 LISTEN；herdweb 主进程 **2206374** 未变（tsx 子进程 pid 会自己换，不是探针杀的）
- 未向 0.0.0.0 bind，未用 7681

## 复现

`bash docs/sessions/plugin-design/probes/run-all.sh`；只重跑 D：`PROBE_ONLY=D bash …/run-all.sh`。
证据在 `/tmp/herdweb-probe-runtime/evidence/`。`serve.py` 是最小账本，`plugin/` 是临时 herdr plugin（id=`probe.runtime`）。
