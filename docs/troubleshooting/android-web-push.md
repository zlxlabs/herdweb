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

> 已实现：页面加载时，若已授予通知权限且浏览器里有订阅，会自动向服务端重新上报该订阅；VAPID 公钥变化时会自动退订并重新订阅，避免此类不一致。

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

处置（让 Google Play 服务的省电策略变为「无限制」）：

1. 首选：设置 -> 应用 -> 应用管理 -> Google Play 服务 -> 省电策略 -> 无限制。
2. HyperOS 上该页面可能没有「无限制」选项。此时用 root 通过「电量与性能」（`com.miui.powerkeeper`）的配置 ContentProvider 修改，与设置界面走同一条路径：

```bash
# 查询当前策略（miuiAuto = 智能限制）
adb shell "su -c 'content query --uri content://com.miui.powerkeeper.configure/userTable --where \"pkgName=\\\"com.google.android.gms\\\"\"'"
# 改为无限制
adb shell "su -c 'content update --uri content://com.miui.powerkeeper.configure/userTable --bind bgControl:s:noRestrict --where \"pkgName=\\\"com.google.android.gms\\\" AND userId=0\"'"
```

改完数秒内 powerkeeper 会自行重写 `MILLET_NO_RESTRICT_APP`，其中出现 `com.google.android.gms` 即生效（自查：`adb shell settings get system MILLET_NO_RESTRICT_APP`）。之后亮屏再锁屏一次，让冻结策略重新判定。

不要直接 `settings put system MILLET_NO_RESTRICT_APP ...`：该名单由「电量与性能」维护（`dumpsys settings` 中该键的写入方为 `pkg:com.miui.powerkeeper`），是各应用「省电策略 = 无限制」的汇总。powerkeeper 会按自己的数据库定期整份重写，手动追加的项约 1 小时内就会被冲掉，Google Play 服务随即再次被 quick freeze。

验证：锁屏后 greezer 历史中不再出现 gms 的 `quick freeze`，GcmService 保持 `connected=`。

实测：锁屏 5 分钟后发送测试推送，约 1.5 秒送达。

## 4. 持久性说明

- 该策略存于 powerkeeper 自身的数据库（用户数据），重启与普通 OTA 一般会保留。
- 会失效的情形：
  - 恢复出厂，或清除「电量与性能」的数据。
  - 大版本系统更新可能改变机制或键名。
- OTA 后 root 往往需要重新修补；root 恢复前 LSPosed / FCM Fix 不生效，作用域配置会保留。
- 自查一行（powerkeeper 汇总后的结果），看输出是否含 `com.google.android.gms`：

```bash
adb shell settings get system MILLET_NO_RESTRICT_APP
```

## 5. 补充

- 推送 TTL 为 24 小时；`asking` 与 `act_now` 级事件以 high urgency 发送，其余事件使用 Web Push 默认 urgency（详见 [`docs/configuration.md`](../configuration.md)）。
- 测试时手机插着 USB 充电，不会进入最深的 Doze；建议拔线放置一段时间后再验证一次。
- 无 root 设备无法使用上述 Millet 设置与 FCM Fix，可依赖出站通道（message-pusher、企业微信 webhook，见 [`docs/configuration.md`](../configuration.md) 的通知配置部分）作为兜底。
- 对比参考：同一设备上其他使用标准 Web Push 的 PWA（例如 HAPI）受同样影响，这不是 herdweb 特有的问题。
