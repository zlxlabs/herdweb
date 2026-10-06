# Android（小米 HyperOS）上 PWA 收不到 Web Push 的排查与修复

本文面向自托管用户，记录一次完整排查的结论。命令中的 `<...>` 均为占位符，请替换为你自己的值。

## 1. 症状

- iOS 上的 PWA 能正常收到推送。
- Android（Edge / Chrome 安装的 PWA）收不到，或者只有亮屏、打开应用时才一次性收到一批。
- 通知面板显示权限已允许、Service Worker 已激活、开关已勾选。

## 2. 推送链路与分层定位

链路：

```
herdweb 服务端
  -> 浏览器推送服务（Android 上为 FCM，fcm.googleapis.com）
  -> 手机上 Google Play 服务与 mtalk.google.com:5228 的长连接
  -> 浏览器
  -> Service Worker 的 push 事件
  -> showNotification
```

按层从上往下查，找到第一个断点即可。

### 2.1 服务端是否登记了该设备的订阅

查看状态目录 `~/.local/state/herdweb/<port>/push-subscriptions.json`，只确认是否存在 `fcm.googleapis.com` 的 endpoint，不要打印完整 endpoint（它是推送凭据）：

```bash
grep -c 'fcm.googleapis.com' ~/.local/state/herdweb/<port>/push-subscriptions.json
```

### 2.2 服务端是否发出

```bash
# systemd 部署
journalctl --user -u herdweb.service | grep 'notify push'
# 或直接查日志
grep 'notify push delivered →' <日志文件>
```

日志里出现 `fcm.googleapis.com` 只说明 FCM 接收了，不代表手机收到。

### 2.3 手机 FCM 长连接状态

```bash
adb shell dumpsys activity service com.google.android.gms/.gcm.GcmService
```

重点看：

- `connected=mtalk.google.com...` 表示长连接在线；`Not connected` 表示已断开。
- `Reconnect Scheduler Alarm: in PT-...`：负数表示重连闹钟已过期却未执行。
- `Heartbeat alarm delay: -...`：负数表示心跳迟到。
- `Successful broadcast to com.microsoft.emmx`（Chrome 则为 `com.android.chrome`）：表示消息已交给浏览器。

### 2.4 通知是否被系统发出

```bash
adb shell dumpsys notification --noredact | grep -A3 'herdweb'
```

### 2.5 对照实验：强制唤醒长连接

```bash
adb shell am broadcast -a com.google.android.intent.action.GTALK_HEARTBEAT
```

如果积压的推送立刻送达，说明问题出在手机上的长连接，而不是 herdweb。

## 3. 本次确认的三个根因（叠加）

### a. 服务端没有该设备的订阅

浏览器里残留了旧实例（VAPID 密钥不同）创建的订阅。面板开关只看浏览器本地订阅，所以显示已开启，但服务端并没有登记。

处置：在通知面板里把推送开关关掉再打开，重新订阅。

> 计划中的改进：页面加载时自动对账本地订阅与服务端登记，避免此类不一致。

### b. FCM Fix（LSPosed 模块，需 root）作用域不全

该模块有三组钩子，分别作用于：

| 作用域 | 作用 |
|---|---|
| 系统框架 `android` | 框架层修复 |
| Google Play 服务 `com.google.android.gms` | 重连与心跳修复（ReconnectManagerFix） |
| 电量与性能 `com.miui.powerkeeper` | PowerkeeperFix |

只勾系统框架时，重连修复不生效。

处置：LSPosed -> FCM Fix -> 作用域，勾选以上三项，然后重启。

验证：LSPosed 模块日志中出现以 `[fcmfix] [com.google.android.gms]` 开头、且含「更新hook位置成功」的行。

### c. 主因：HyperOS 的 Millet / Greeze 进程冻结在锁屏后冻结了 Google Play 服务主进程

新版 Google Play 服务的 GcmService 运行在主进程 `com.google.android.gms`，而系统自带白名单 `power_proc_white_list` 只覆盖 `com.google.android.gms.persistent`，所以主进程会被冻结，长连接随之失效。

证据命令：

```bash
# 取得 gms 的 uid
adb shell dumpsys package com.google.android.gms | grep userId

# 查看冻结记录，出现 "FZ ... reason : quick freeze" 即被冻结
adb shell su -c 'dumpsys greezer' | grep 'uid = <gms 的 uid>'

# 进程等待点：do_freezer_trap 表示被冻结（正常应是 do_epoll_wait 之类）
adb shell su -c 'cat /proc/<pid>/wchan'
```

被冻结时，`dumpsys ... GcmService` 也会超时。

处置：把 `com.google.android.gms` 加入 `MILLET_NO_RESTRICT_APP`（system 命名空间，逗号加空格分隔）：

```bash
old=$(adb shell settings get system MILLET_NO_RESTRICT_APP)
echo "$old" > millet_no_restrict.bak   # 先备份
adb shell settings put system MILLET_NO_RESTRICT_APP "'$old, com.google.android.gms'"
```

若原值为 `null`（未设置），直接写 `com.google.android.gms`：

```bash
adb shell settings put system MILLET_NO_RESTRICT_APP com.google.android.gms
```

之后亮屏再锁屏一次，让冻结策略重新判定。

验证：锁屏后 greezer 历史中不再出现 gms 的 `quick freeze`，GcmService 保持 `connected=`。

实测：修复后，锁屏熄屏状态下从服务端发出到通知弹出约 1 秒。

## 4. 持久性说明

- 该设置存于用户数据（Settings.System），重启与普通 OTA 不会丢失；生效不依赖 root。
- 会失效的情形：
  - 恢复出厂或清除数据。
  - 名单原本由第三方工具（如 Scene 等）维护，工具再次写入会覆盖，建议在该工具里同样加入 Google Play 服务。
  - 大版本系统更新可能改变机制或键名。
  - 云端省电策略理论上可能覆盖（未观察到）。
- OTA 后 root 往往需要重新修补；root 恢复前 LSPosed / FCM Fix 不生效，作用域配置会保留。
- 自查一行，看输出是否含 `com.google.android.gms`：

```bash
adb shell settings get system MILLET_NO_RESTRICT_APP
```

## 5. 补充

- 测试时手机插着 USB 充电，不会进入最深的 Doze；建议拔线放置一段时间后再验证一次。
- 无 root 设备无法使用上述 Millet 设置与 FCM Fix，可依赖出站通道（message-pusher、企业微信 webhook，见 [`docs/configuration.md`](../configuration.md) 的通知配置部分）作为兜底。
- 对比参考：同一设备上其他使用标准 Web Push 的 PWA（例如 HAPI）受同样影响，这不是 herdweb 特有的问题。
