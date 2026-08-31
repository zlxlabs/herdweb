# DESIGN-note：先修切目标，再单独处理剩余导航超时

## 目标

手机上换一个目标之后，地址栏和刷新都能停在刚选的那个目标。本地全量端到端不再被三十秒导航超时打成几乎每轮都红。

## 非目标

不修方向键。不调大超时。不给本地开重试。不 skip 测试。不在通知入口把秒启发式换成毫秒。不默认屏蔽 Service Worker。不把 Synced 塞进重连文案。不自托管字体。不用内联 onload 切媒体。

## 方案要点与已否决方案

- 要点：两张卡串行，因为全量端到端测量独占本机浏览器和 CPU，并行会把超时计数污染掉。第一张只修 WebKit 切目标（当前最高格 4/10）。第二张先抓 Chromium 三十秒导航超时的 trace，确认挂住的 URL，再只改一件事。字体样式表已经改成 media=print，剩余超时可能是切回 all 之后 woff2 仍挡住 load，但以新 trace 为准，不以旧诊断直接开工。
- 已否决：现在修 webkit 长按回车。调大 timeout / 本地 retries / test.skip。入口把秒换成毫秒。发送方改完就关 #129 不加 400。默认屏蔽 Service Worker。把 Synced 塞进重连文案。自托管字体。内联 onload 切媒体。两张测量卡并行。

## 关键不变式

1. 点 two 之后 window.location 含 target=two，刷新仍是 Two。代码：src/client-entry.ts attach-committed 调用 persistUrlTargetId；src/target-restore.ts persistUrlTargetId。测试：tests/playwright/target-switch.spec.ts 徽章那条，加上 tests/target-restore.test.ts 对 replaceState 的单测。
2. 修导航超时必须先有当前主干上的 hang trace，pending 请求写进文档，再只改一件事。对照：docs/sessions/herdweb-e2e-flake/baseline-after-c1-c2.md 的 kind (a)=14。成功是 kind (a) 实例数下降，不是单轮全绿。

## 验收路径

1. 入口：Playwright webkit-iphone，tests/playwright/target-switch.spec.ts 里徽章切目标那条；以及后续全量套件 10 轮 JSON walk。
2. 步骤：切目标卡用 env -u CI 对该用例连跑 10 轮，失败必须是 0。导航超时卡必须 env -u CI，空闲检查后再走 10 轮全量，比较 kind (a) 实例数。
3. 预期：切目标那格从 4/10 变成 0/10。导航超时卡要么 kind (a) 下降，要么停在有 pending URL 的诊断文档并 blocked，不扩大范围。
