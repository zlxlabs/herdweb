# herdweb 干净机器构建门槛实测

测量日：2026-08-31。宿主 linux x86_64，Docker 29.7.2。仓库 `eebc717`（`git archive HEAD` 打进容器，等价于干净 clone）。复现：`bash docs/sessions/plugin-design/probes/build-matrix.sh`。原始日志：`/tmp/herdweb-build-matrix/`（不入库）。

每格都跑设计草案那两条命令（格 s1 额外加 `--ignore-scripts`）：

```
npx --yes pnpm@10 install --frozen-lockfile
npx --yes pnpm@10 run build:dist
```

实测 `npx` 拉到 pnpm **10.34.5**，镜像内 Node **v22.23.2**。`docker_exit` 在本次跑次里恒为 0（当时 harness 吞了非零）；**herdr 会看到的是 `install` / `build:dist` 的退出码**，见下表。已提交脚本会把该退出码传出容器。

## 结论

这条 `pnpm@10 install --frozen-lockfile` → `pnpm run build:dist` 链**撑不起 Linux 上一行安装**。`node-pty@1.1.0` 的 npm 包自带 darwin/win32 预编译，**不带任何 linux 预编译**（格 p1）；Linux 上 `prebuild.js` 找不到 `prebuilds/linux-x64` 就 `node-gyp rebuild`（格 1 L28–L29）。只有 Node 的干净机（`node:22-slim` / Alpine）会在缺 Python 处退出码 1（格 1/4/5）；补上 `python3 make g++` 或使用自带工具链的 `node:22` 则 install+`build:dist`+`require('node-pty')` 都过（格 2/3）。`npm_config_build_from_source=false` 变不出 Linux 预编译（格 5）。`--ignore-scripts` 能做出 `dist/`，但 PTY 加载失败（格 s1）——构建通过 ≠ 运行可用。macOS 用户按预编译目录存在即跳过 gyp 的脚本逻辑（格 1 L29 + 格 p1）大概率不用本地编译；本矩阵没有在 darwin 上跑 `require()`，不声称 Node 22 加载那些 `.node` 一定成功。

## 镜像

| 标签 | digest（linux/amd64） |
|---|---|
| `node:22-slim` | `sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5` |
| `node:22` | `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d` |
| `node:22-alpine` | `sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32` |

## 矩阵总表

耗时列为该步秒数；docker 墙钟另计（格 2 含 `apt-get`，81s）。

| # | 环境 | 额外 | install | 秒 | build:dist | 秒 | 走 gyp | require(node-pty) | dist/ |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `node:22-slim` Debian 12 | 无；python3/make/g++/cc=missing | **1** | 20 | skipped | — | 是，缺 Python | fail | 无 |
| 2 | 同 slim | `apt-get install python3 make g++`（apt.exit=0） | 0 | 22 | 0 | 4 | 是，`gyp info ok` | **ok** | 有 |
| 3 | `node:22` Debian 12 | 无（镜像自带 Python 3.11.2 / make / g++） | 0 | 22 | 0 | 4 | 是，`gyp info ok` | **ok** | 有 |
| 4 | `node:22-alpine` 3.24 | 无；工具链 missing | **1** | 18 | skipped | — | 是，缺 Python（未碰到 musl 链接） | fail | 无 |
| 5 | slim + `npm_config_build_from_source=false` `npm_config_fallback_to_build=false` | 无 | **1** | 18 | skipped | — | 是，与格 1 同因 | fail | 无 |
| s1 | slim + `--ignore-scripts` | 无 | 0 | 17 | 0 | 4 | 否（未跑 install 脚本） | **fail** | 有 |

`build:dist` 成功时约 4s，写出 overlay 等约 25 个 dist 文件。格 2/3 的 `CXX(target) .../pty.o` + `SOLINK_MODULE ... pty.node` + `gyp info ok` 证明 Linux 成功路径就是源码编译，不是 prebuild。

## 格 1 — 最坏情况（slim，无工具链）

命令：上述两条。`install` 退出码 **1**（20s）。`python3=missing`。

前 30 行（herdr 若从头截断，用户只能看到这些；摘录只去掉了 CSI 颜色码）：

```
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +482
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 482, reused 0, downloaded 51, added 50
Progress: resolved 482, reused 0, downloaded 119, added 119
Progress: resolved 482, reused 0, downloaded 218, added 218
 WARN  Tarball download average speed 6 KiB/s (size 6 KiB) is below 50 KiB/s: https://registry.npmjs.org/rc/-/rc-1.2.8.tgz (GET)
Progress: resolved 482, reused 0, downloaded 341, added 341
Progress: resolved 482, reused 0, downloaded 395, added 395
 WARN  Tarball download average speed 19 KiB/s (size 22 KiB) is below 50 KiB/s: https://registry.npmjs.org/@vitest/expect/-/expect-3.2.4.tgz (GET)
 WARN  Tarball download average speed 8 KiB/s (size 15 KiB) is below 50 KiB/s: https://registry.npmjs.org/@ampproject/remapping/-/remapping-2.3.0.tgz (GET)
Progress: resolved 482, reused 0, downloaded 443, added 443
Progress: resolved 482, reused 0, downloaded 467, added 467
Progress: resolved 482, reused 0, downloaded 474, added 474
 WARN  Tarball download average speed 3 KiB/s (size 14 KiB) is below 50 KiB/s: https://registry.npmjs.org/loupe/-/loupe-3.2.1.tgz (GET)
Progress: resolved 482, reused 0, downloaded 477, added 477
Progress: resolved 482, reused 0, downloaded 478, added 477
Progress: resolved 482, reused 0, downloaded 478, added 478
Progress: resolved 482, reused 0, downloaded 479, added 479
Progress: resolved 482, reused 0, downloaded 481, added 481
Progress: resolved 482, reused 0, downloaded 482, added 481
Progress: resolved 482, reused 0, downloaded 482, added 482, done
.../node-pty@1.1.0/node_modules/node-pty install$ node scripts/prebuild.js || node-gyp rebuild
.../node_modules/@biomejs/biome postinstall$ node scripts/postinstall.js
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.27.4/node_modules/esbuild postinstall$ node install.js
.../node-pty@1.1.0/node_modules/node-pty install: > Checking prebuilds...
.../node-pty@1.1.0/node_modules/node-pty install: > Rebuilding because directory /work/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/linux-x64 does not exist
.../node-pty@1.1.0/node_modules/node-pty install: gyp info it worked if it ends with ok
```

真正说明缺 Python 的行在 L35–L73（共 73 行）。关键句：`gyp ERR! find Python You need to install the latest version of Python.`（L46）、`Error: Could not find any Python installation to use`（L59）、`ELIFECYCLE  Command failed with exit code 1.`（L73）。biome/esbuild 的 postinstall 在失败前已 `Done`（L33–L34、L72），它们不需要编译器。

## 格 2 — slim + 工具链

`apt-get install -y --no-install-recommends python3 make g++` 退出 0。随后同一条 `pnpm@10 install` 退出 0（22s）：L35 `find Python using Python version 3.11.2 found at "/usr/bin/python3"`，L69 `CXX(target) Release/obj.target/pty/src/unix/pty.o`，L70 `SOLINK_MODULE(target) ... pty.node`，L73 `gyp info ok`。`build:dist` 退出 0（4s）。`require('node-pty')` → `require=ok`。

## 格 3 — 完整 `node:22`

未装任何包。环境已有 Python 3.11.2、`/usr/bin/make`、`/usr/bin/g++`。install 0（22s）同样 `Checking prebuilds` → 无 linux-x64 → `spawn make` → `gyp info ok`。`build:dist` 0（4s）。`require=ok`。官方完整 Node 镜像对这条链是够的；这不等于「用户只装了 nvm/fnm 的桌面机」够。

## 格 4 — Alpine

`NAME="Alpine Linux"` `VERSION_ID=3.24.1`；python3/make/g++/cc=missing。`install` 退出 **1**（18s）。挂在缺 Python，**没有**走到 musl/`g++` 链接错误。

前 30 行：

```
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +482
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 482, reused 0, downloaded 47, added 47
Progress: resolved 482, reused 0, downloaded 103, added 103
 WARN  Tarball download average speed 1 KiB/s (size 1 KiB) is below 50 KiB/s: https://registry.npmjs.org/path-type/-/path-type-4.0.0.tgz (GET)
Progress: resolved 482, reused 0, downloaded 220, added 219
Progress: resolved 482, reused 0, downloaded 312, added 311
Progress: resolved 482, reused 0, downloaded 369, added 369
 WARN  Tarball download average speed 15 KiB/s (size 21 KiB) is below 50 KiB/s: https://registry.npmjs.org/@pkgjs/parseargs/-/parseargs-0.11.0.tgz (GET)
Progress: resolved 482, reused 0, downloaded 415, added 415
Progress: resolved 482, reused 0, downloaded 463, added 463
Progress: resolved 482, reused 0, downloaded 469, added 469
 WARN  Tarball download average speed 8 KiB/s (size 31 KiB) is below 50 KiB/s: https://registry.npmjs.org/esbuild/-/esbuild-0.27.4.tgz (GET)
Progress: resolved 482, reused 0, downloaded 471, added 471
Progress: resolved 482, reused 0, downloaded 472, added 472
Progress: resolved 482, reused 0, downloaded 473, added 473
Progress: resolved 482, reused 0, downloaded 474, added 474
 WARN  Tarball download average speed 43 KiB/s (size 326 KiB) is below 50 KiB/s: https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz (GET)
Progress: resolved 482, reused 0, downloaded 478, added 478
Progress: resolved 482, reused 0, downloaded 480, added 480
Progress: resolved 482, reused 0, downloaded 481, added 481
Progress: resolved 482, reused 0, downloaded 482, added 482, done
.../node-pty@1.1.0/node_modules/node-pty install$ node scripts/prebuild.js || node-gyp rebuild
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.27.4/node_modules/esbuild postinstall$ node install.js
.../node_modules/@biomejs/biome postinstall$ node scripts/postinstall.js
.../node-pty@1.1.0/node_modules/node-pty install: > Checking prebuilds...
.../node-pty@1.1.0/node_modules/node-pty install: > Rebuilding because directory /work/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/linux-x64 does not exist
```

L61：`Could not find any Python installation to use`。L74：`ELIFECYCLE  Command failed with exit code 1.`

## 格 5 — 有没有可用的 prebuild 通道？

环境与格 1 相同，仅多 `npm_config_build_from_source=false` 与 `npm_config_fallback_to_build=false`。`install` 仍 **1**（18s）。`prebuild.js` 只在该变量为字符串 `true` 时才删预编译并强制 rebuild；设为 `false` 等于默认。Linux 没有预编译目录，仍 `|| node-gyp rebuild`。`fallback_to_build` 是 prebuild-install 的约定，这套自定义脚本不读它。

前 30 行：

```
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +482
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 482, reused 0, downloaded 56, added 54
Progress: resolved 482, reused 0, downloaded 149, added 149
Progress: resolved 482, reused 0, downloaded 250, added 250
Progress: resolved 482, reused 0, downloaded 349, added 349
Progress: resolved 482, reused 0, downloaded 399, added 399
Progress: resolved 482, reused 0, downloaded 442, added 442
Progress: resolved 482, reused 0, downloaded 466, added 466
Progress: resolved 482, reused 0, downloaded 471, added 471
Progress: resolved 482, reused 0, downloaded 473, added 473
Progress: resolved 482, reused 0, downloaded 474, added 474
Progress: resolved 482, reused 0, downloaded 477, added 477
Progress: resolved 482, reused 0, downloaded 478, added 478
Progress: resolved 482, reused 0, downloaded 479, added 479
Progress: resolved 482, reused 0, downloaded 480, added 480
Progress: resolved 482, reused 0, downloaded 481, added 481
Progress: resolved 482, reused 0, downloaded 482, added 482, done
.../node-pty@1.1.0/node_modules/node-pty install$ node scripts/prebuild.js || node-gyp rebuild
.../node_modules/@biomejs/biome postinstall$ node scripts/postinstall.js
.../esbuild@0.27.4/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../node-pty@1.1.0/node_modules/node-pty install: > Checking prebuilds...
.../node-pty@1.1.0/node_modules/node-pty install: > Rebuilding because directory /work/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/linux-x64 does not exist
.../node-pty@1.1.0/node_modules/node-pty install: gyp info it worked if it ends with ok
.../node-pty@1.1.0/node_modules/node-pty install: gyp info using node-gyp@11.5.0
.../node-pty@1.1.0/node_modules/node-pty install: gyp info using node@22.23.2 | linux | x64
.../node_modules/@biomejs/biome postinstall: Done
```

L56 同格 1：`Could not find any Python installation to use`。

## 补充探测

### node-pty@1.1.0 预编译（格 p1）

`npm pack node-pty@1.1.0`：tgz 15 468 777 字节，286 个文件。`package.json` 的 install 是 `node scripts/prebuild.js || node-gyp rebuild`（不是 prebuild-install / node-gyp-build）。`prebuild.js` 看 `prebuilds/${process.platform}-${process.arch}` 目录在不在，在就 exit 0，不在就 exit 1 落到 gyp。

tarball 里的 `prebuilds/`：

- 有：`darwin-arm64/pty.node` + `spawn-helper`；`darwin-x64/` 同上；`win32-x64/` 与 `win32-arm64/` 的 `pty.node` / conpty / winpty
- **无**：`linux-x64`、`linux-arm64`、任何 `linux-*-musl`

因此：Node 22 + **linux x64** — 无预编译（格 1 L29 + 格 p1）。**linux arm64** — 包里同样没有对应目录，本宿主是 amd64，未跑 arm64 容器。**darwin x64/arm64** — 包里有目录；按格 1 实测的判定规则会跳过 gyp。未在 macOS 上跑 Node 22 `require()`。

### `--ignore-scripts`（格 s1）

slim、无工具链。`pnpm@10 install --frozen-lockfile --ignore-scripts` 退出 0（17s），日志里**没有** `node-pty ... install$`。`build:dist` 退出 0（4s），`dist/` 有文件。`require('node-pty')` → `Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64`。插件能「装完并产出 dist」，开不了 PTY。

### 还有没有别的本地编译？

有 install 脚本的是 `node-pty`（gyp）、`@biomejs/biome`、两份 `esbuild`（postinstall 下载官方二进制）。格 1 里 biome/esbuild 都 `Done`，失败只来自 node-pty。lockfile 无 `prebuild-install` / `node-gyp-build`。pnpm 10.34.5 会执行这些 lifecycle（`pnpm-workspace.yaml` 的 `allowBuilds` 是 pnpm 11 字段，本链用 pnpm@10，未挡住脚本）。

## 请一并回答

### 1. 失败体验

不能指望不懂 node-gyp 的人从「前 30 行」看出缺 Python 和编译器。格 1 共 73 行，前 30 行几乎全是下载进度；第 24 行才出现 `node-gyp rebuild`，第 29 行是缺少 `prebuilds/linux-x64`。`You need to install the latest version of Python` 在 L46，`Could not find any Python` 在 L59。若 herdr 截的是**尾部**，用户能看到 Python 句；若截的是**头部**，看起来像网络慢或缺某个 linux 文件。全文也**没有**提到 `g++`/`make`——格 1 在找到 Python 之前就退出了。

前置检查（Linux）：`command -v python3`、`make`、`c++`/`g++` 都要在 PATH 里，缺一则不要开 `pnpm install`。措辞建议：「herdweb 在 Linux 上要本地编译 node-pty（npm 包不带 Linux 预编译）。请先安装 Python 3、make 和 C++ 编译器。Debian/Ubuntu：`sudo apt install python3 make g++`。macOS 一般不用装这些，包里已有 darwin 预编译。」检查「环境变量键在不在」不够；compose 默认空值会让键恒在。应用 `python3 --version` 这类真能跑起来的探测。

### 2. 覆盖率估计

依据是格 1–5 与格 p1，不是问卷。

| 用户类型 | 预期 | 依据 |
|---|---|---|
| macOS（含仅 CLT / 甚至没 CLT） | install 多半不走 gyp | 格 p1 有 darwin 预编译目录；格 1 L29 证明目录存在即不 rebuild。未测 darwin `require()` |
| 开了官方 `node:22` 那种带工具链的 Linux，或 Ubuntu 桌面已有 `build-essential` | 一次能装成 | 格 3、格 2 |
| 只用 nvm/fnm/apt 装了 Node 的 Linux 桌面，没 Python/g++ | 挂，同格 1 | 格 1 |
| 服务器 minimal / 容器 slim | 挂 | 格 1 |
| Alpine / musl | 挂（本次死在 Python，补工具链后 musl 是否能链过未测） | 格 4 |
| Windows | 包里有 win32 预编译，本矩阵未跑 | 格 p1 |

herdr 手机控电脑：Linux 家用机/服务器是「一行安装」的主要风险面；Mac 风险低得多（预编译在包里），Linux 干净机几乎必挂。

### 3. 别的分发路径（只评估，不实现）

现有 `npm_config_*` 通道走不通（格 5）。可行绕开本地编译的办法都要**自己提供 Linux 预编译**，不能指望这条 pnpm install。

1. **GitHub Release 附 `pty.node`（linux-x64-gnu、linux-arm64-gnu；可选 musl）**，manifest 的 build 改成按 `uname` 下载再跑 `build:dist`。代价：CI 要在 glibc 镜像里编一次（格 2 证明能编），处理 spawn-helper 可执行位，Node ABI 因 `node-addon-api` 相对稳但仍要抽检；Alpine 仍要单独产物。与「本 fork 不发 npm」不冲突。
2. **Release 一个已 `pnpm install`+`build:dist` 的 tarball**（含编译好的 node-pty）。代价：体积和平台矩阵都大，Node 小版本也可能不兼容。
3. **herdr 在带工具链的容器里跑 build**。用户机器干净也能装；产物若拷回 musl 宿主仍可能不能用（格 4 未测到链接步）。
4. **等 upstream 把 linux 预编译打进 npm 包**。darwin/win32 已经这样分发（格 p1），Linux 是缺口；时间不在本仓。
5. **`--ignore-scripts` 不能当安装成功**（格 s1：dist 有、PTY 无）。

没有「设一个环境变量就全体用户免编译」的路径。要「一行安装」在 Linux 成立，必须改分发物（预编译 artifact），不能只改 manifest 里那两行 pnpm。
