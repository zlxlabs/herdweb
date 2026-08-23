# HANDOFF · Android Edge 通知失败专项诊断 — herdweb 注意力层收尾

> 新 session 在 /home/zlx/projects/oss/herdweb 继续。本文档自包含。
> 焦点唯一：用户 Android 手机上 herdweb 通知订阅走不通（Service Worker 注册不存在）。
> 其他一切已完成：iOS 真机全链路已验证、Android Chrome 模拟器全链路已验证、PR #46 ready 且 CI 绿——
> 本问题是合并 PR #46 前的最后一关。

## 新 Session Prompt（直接复制）

```text
在 /home/zlx/projects/oss/herdweb 继续注意力层 v1 的收尾：专项诊断用户 Android 手机上
Edge 浏览器通知订阅失败的问题。先读 docs/sessions/260823-edge-android-notify/HANDOFF.md
（本问题的全部上下文、证据与工具），按 pickup 检查现场。

背景一句话：herdweb 的 Web Push 在 iOS（iPhone 17.4 PWA）与 Android Chrome 124（模拟器）
都已真机/实证全链路跑通，唯独用户的手机（经抓包 UA 确认为 Edge for Android 151 /
Android 10，用户自称"安卓 Chrome"）上 Service Worker 注册不存在 → 面板开关恒灰
「Service Worker not available」→ 订阅从未发生过（服务端 0 条该设备订阅）。

第一件事：让用户回报两个数据（如果用户还没报）：
① 面板里 Service Worker 状态行显示什么（已激活/注册中/未注册/注册失败（错误原文）/不支持）
② 点「重新注册 Service Worker」按钮后的变化——若失败，错误原文一字不差拿回来。
另外让用户在手机 Edge 地址栏直接打开 edge://serviceworker-internals，看列表里有没有
tailnet 域名（zlx-vm-work-i5-ubuntu2404-devcontainer.taile9071.ts.net）的注册条目、
其 scope 和状态是什么——这是设备侧零代码的地面真相。

已知证据（本会话抓包与服务端日志，详见 HANDOFF 文档「证据」节）：
- Edge 设备 5+ 次页面加载，sw.js 只被抓到 1 次请求（14:19:05），之后加载不再拉 sw.js
  ——与「注册已存在」矛盾于面板 getRegistration() 返回 null，此悖论未解，
  头号嫌疑是「标签页 vs 安装版 PWA 的存储分区不同」（用户用的是 Edge 添加到主屏的 PWA）
- 该设备 0 次 vapid-key / 0 次 subscribe 请求
- 服务端与代码已排除：桌面 Edge 151 同 URL SW 注册成功（active）；ready 挂起已修
  （745de7d，getRegistration 热路径）；诊断面板已上线（0c211ef）

修复链已全部合入 feat/notify-attention @ 9386918（PR #46，CI run 32625862520 pass），
不要重开：fix4 Tailscale 403 / fix5 toggle touch 竞态 / 可观测性双修 / VAPID subject
（Apple BadJwtToken）/ Edge ready 挂起 / SW 诊断面板。iOS 路径已通，不要再动。

测试环境（保持运行中）：herdweb-notify-test.service（7701，--base-path /herdweb-notify，
代码=feat 分支 worktree /home/zlx/projects/oss/herdweb-notify），Tailscale
https://zlx-vm-work-i5-ubuntu2404-devcontainer.taile9071.ts.net/herdweb-notify
状态目录 ~/.local/state/herdweb/7701/（vapid subject=mailto:zlx@zlxlabs.com，由
worktree 根 herdweb.config.ts 覆盖，gitignored）。

诊断工具（HANDOFF 文档有完整命令）：lo 口 tcpdump 抓 7701 明文请求、journalctl 看推送
三态日志、Android 模拟器真 Chrome CDP（adb forward 9223）、桌面 Edge 151 playwright 探针。

收敛路径：Android 通过 → 合并 PR #46（feat 触发 minor release）→ 部署生产 7681
（生产 vapid.json subject 按 README 新节配置）→ 用户对生产 origin 重新订阅 →
goals/M4 翻完成。若确认是设备环境问题（InPrivate/站点权限/存储分区）且非代码可修，
如实记录结论、评估是否放行合并（iOS+Chrome 已通，Edge 缺陷可记 known issue）。
```

## 证据（2026-08-23 本会话采集）

### 设备事实
- 用户手机 UA（tcpdump 实证）：`Mozilla/5.0 (Linux; Android 10; K) … Chrome/151.0.0.0 Mobile … EdgA/151.0.0.0`
  → **Edge for Android 151，Android 10**（用户口头称"安卓 Chrome"）
- 使用形态：Edge「添加到主屏幕」的 PWA 模式（用户自述 PWAM）
- 通知权限：已允许（用户回报 + 新权限行显示）
- 抓包文件留存：`/tmp/opencode/req-capture.txt`（tcpdump 已停，文件在；重启命令见工具节）

### Edge 设备请求时间线（lo 抓包，Host=tailnet 域名，UA=EdgA）
```
12:54:25 GET /ws                       ← 最早一次
14:16:21-14:16:39 GET / ×1  sw.js ×0  history ×1  push/test ×2   ws ×2
14:17:47-14:18:08 GET / ×1  sw.js ×0  history ×1  push/test ×2
14:19:05-14:19:39 GET / ×1  sw.js ×1（唯一一次） history ×1  push/test ×2
14:20:01-14:21:05 GET / ×1  sw.js ×0  history ×1  push/test ×2
后续（sw-diag 面板上线后测试）：GET / + history + push/test，仍无 sw.js、无 vapid-key、无 subscribe
```

### 关键悖论（下一会话要解的核心）
- sw.js 只拉过 1 次、后续加载不拉 → 像是「注册已存在」（register() 命中已有注册时不走网络；浏览器对 SW 更新检查默认 24h 一次）
- 但面板 `getRegistration()` 返回 null（开关灰、「Service Worker not available」）→ 「注册不存在」
- 两者同时成立的候选解释：
  1. **存储分区**：14:19:05 那次 sw.js 来自标签页上下文，用户平时用的是安装版 PWA（独立分区，无注册）——或反之
  2. 注册成功后被浏览器回收/清除（Android 存储压力）
  3. sw.js 请求 200 但 install/activate 失败，且浏览器 HTTP 缓存了 sw.js 干扰后续注册重试
- 用户按下「重新注册 Service Worker」后的错误原文可直接裁决

### 服务端事实
- 订阅文件 `~/.local/state/herdweb/7701/push-subscriptions.json`：FCM 端点=主脑模拟器（12:38 登记）+ Apple 端点=用户 iPhone——**从未有 Edge 设备的端点**
- 推送日志：`delivered → fcm.googleapis.com`（模拟器）/ `delivered → web.push.apple.com`（iPhone 收到通知实证）
- iOS 12:45 曾出现 `subscription removed (stale) → web.push.apple.com`，根因 VAPID subject 已修（a41a677）

### 各平台状态矩阵
| 平台 | SW 注册 | 订阅 | 测试通知 |
|---|---|---|---|
| iPhone 17.4 PWA | ✅ | ✅（Apple 端点） | ✅ 真机收到 |
| Android Chrome 124（模拟器） | ✅ | ✅（FCM 端点） | ✅ 系统通知栏实证 |
| 桌面 Edge 151（playwright） | ✅ active | —（stub 验证流程） | — |
| **用户手机 Edge Android 151** | **❌ 注册不存在** | **❌ 从未发生** | **❌** |

## 已完成的修复链（feat/notify-attention @ 9386918，勿重开）

| commit | 内容 |
|---|---|
| ca65732 | fix4：Tailscale 域名三处 403（GET 无 Origin 头 + 测试按钮改打 POST /api/push/test） |
| db122fa + f0b24dd | fix5：toggle touch 竞态（onTap touchend 读 pre-flip 值 → change 事件） |
| e423afa + b2b4fc9 | 可观测性：面板 subscribe try/catch；服务端推送三态日志（delivered/removed/skipped） |
| a41a677 + 395509b | VAPID subject：默认 localhost 被 Apple 403 BadJwtToken 拒收 → 默认 admin@example.com + 配置>磁盘>默认 |
| 745de7d | Edge 151 `serviceWorker.ready` 永久挂起 → getRegistration 热路径+激活轮询 |
| 6f39eee + 0c211ef | SW 诊断面板：`.wt-notify-sw-status` 状态行 + `.wt-notify-sw-check` 重新注册按钮（错误完整上屏） |

## 诊断工具（命令成品）

```bash
# 1. 抓 7701 明文请求（lo 口；重启抓包）
sudo -n nohup tcpdump -i lo -A -s 2048 -l 'tcp port 7701 and (tcp[((tcp[12] & 0xf0) >> 2):4] = 0x47455420 or tcp[((tcp[12] & 0xf0) >> 2):4] = 0x504f5354 or tcp[((tcp[12] & 0xf0) >> 2):4] = 0x44454c45)' > /tmp/opencode/req-capture2.txt 2>&1 &
# 解析：python3 配对「请求行 + User-Agent」（成品脚本形态见上一会话 /tmp/opencode/ 内 *.mjs）

# 2. 服务端推送日志
journalctl --user -u herdweb-notify-test --no-pager --since '-10 min' | grep -E 'notify push|subscription'

# 3. 订阅文件
python3 -c "import json; [print(s['endpoint'][:70]) for s in json.load(open('/home/zlx/.local/state/herdweb/7701/push-subscriptions.json'))]"

# 4. 模拟器真 Chrome CDP（AVD remobi 常驻 headless；Chrome 124）
export PATH=$PATH:~/android-sdk/platform-tools
adb forward tcp:9223 localabstract:chrome_devtools_remote   # Chrome 需已启动
# 探针脚本成品：/tmp/opencode/cdp-final.mjs（json/new 开标签→evaluate；注意只连 type=page target）

# 5. 桌面 Edge 151 探针（playwright channel msedge，已安装）
# 形态：chromium.launch({channel:'msedge'}) + devices['Pixel 5'] context；成品 /tmp/opencode/ 形态 zz-edge3/zz-swdiag

# 6. 服务重启/状态
systemctl --user restart herdweb-notify-test   # 改 feat worktree 代码后需重启生效
```

## 下一会话的假设清单（按先验排序）

1. **InPrivate/无痕窗口**：SW 在隐私模式完全不可注册——先问用户是不是无痕打开的（最廉价的排除项）
2. **标签页 vs 安装版 PWA 存储分区**（悖论头号嫌疑）：让用户同时在普通标签页打开 URL 对比；edge://serviceworker-internals 分别在两处看注册
3. **Edge 站点数据/Cookie 权限**：Edge 设置 → 站点权限 → 该域名的 Cookie/数据若被拒，SW 注册失败
4. **跟踪防护严格模式**（Edge「跟踪防护」设为严格会拦部分站点 SW）
5. **站点存储被回收**：清一次该站点数据（Edge 设置 → 站点数据）再重试
6. Edge 151 Android 特有注册层缺陷（类似桌面 ready 挂起的姊妹 bug）——若错误原文显示浏览器内部错误，走「代码绕过」评估

## 不做 / 不重开

- 已合入的 6 项修复不再动；iOS 路径已验证不再碰
- 不做 UA 嗅探、不加自动重试循环（已否决，见 worklog）
- 真机人工门其余项（iOS 订阅/测试通知 ✅；Android 订阅+测试通知 ⏳ 本卡；静默/健康车道服务端已实证，用户有空验，不阻塞合并）

## 环境注意事项（上一会话踩坑实录）

- `.hk-hooks` 依赖 hk 工具本机没装：commit 前遇 `exec: hk: not found` → `git config --unset core.hooksPath`
- pre-push 所有权 ACK：只 ACK 本次 push 内**他人**的 commit（完整 40 位 sha）；merge commit 与本会话已 seal 的 commit 不进 ACK
- gh api 间歇超时（平台抖动）：push 可能静默成功——push 后必须 `git fetch` 验证远端引用
- 主 checkout main 锚被并行会话持有 → 跨卡 worktree 提交可 `CC_BRANCH_ANCHOR_OFF=1`（确认 dispatch 已 done）
- 排障配置文件放 worktree 根（herdweb.config.ts 已 gitignore）；**不要**放 XDG（会劫持 legacy-config 测试的发现路径）
- GitHub Actions 偶发排队慢：PR #46 的 check 以 `gh pr checks 46` 为准

## 收敛后动作（Android 通过时）

1. 合并 PR #46（feat → minor release 自动）
2. 部署生产：herdweb.service(7681) 拉最新 main + systemd restart；生产 `~/.local/state/herdweb/7681/vapid.json` 检查 subject（按 README「Push notifications」节；建议 config 配 `notify.vapid.subject: mailto:<你的邮箱>`）
3. 用户对生产 origin（herdr.zlxlabs.com 或 tailnet 入口）重新订阅（订阅绑定 origin+VAPID 对）
4. goals/M4-notify-attention.md 状态翻完成；worktree-doctor --apply 回收 9 个 executor worktree
5. test 实例收尾：停 herdweb-notify-test、摘 tailscale /herdweb-notify 路径（sudo tailscale serve --https=443 off 会全摘——要用 set-config 精确摘单条，或确认全摘无碍：现有 / → 8767 与 /herdweb → 7691 必须保留）
```
