# 增量 0 Spike 结果：软键盘抑制机制定案（2026-08-18）

> 对应 `docs/designs/keyboard-sovereignty.md` 增量 0。本文件是增量 2 实现卡的前置结论，五项探针的实证回答。

## 方法

- 设备：Android 模拟器（AVD `remobi`，pixel_6，API 35 / Android 15，`hw.keyboard=no` 强制软键盘，KVM 加速）
- 浏览器：Chrome 124.0.6367.219（playstore 镜像自带，版本偏老，见「已知缺口」）
- 探针页：xterm.js 全屏实例 + 自驱动测试跑分（/tmp/remobi-kb-spike/，临时工具不进 git）
- 双信号取证：页面内 `innerHeight - visualViewport.height > 150` 判定 + `adb shell dumpsys input_method` 独立采样，两信号在所有长窗口用例上完全一致 → 该判定方法可信
- 驱动：playwright connectOverCDP 跑页面流程；**弹键盘相关的触摸必须走 `adb shell input tap`**（CDP 注入触摸不触发 Android IME，探针页基线用例自检暴露了这个假阴性）

## 七用例结果

| # | 用例 | 结果 | 判定 |
|---|------|------|------|
| 1 | 基线·无抑制点终端 | 键盘弹了 | ✓ 符合预期 |
| 2 | inputmode=none·程序 focus | 没弹 | ✓ |
| 3 | inputmode=none·真实触摸 | 没弹 | ✓ |
| 4 | readonly·真实触摸 | 没弹 | ✓ |
| 5 | 键盘开着时锁定·仅改属性 | **键盘没收** | 记录 |
| 6 | 键盘开着时锁定·blur+属性 | **键盘收了** | 记录 |
| 7 | 解锁后程序 focus（用户手势内） | 键盘弹了 | ✓ |

## 定案结论（增量 2 实现依据）

1. **机制定案：`inputmode="none"`**。程序 focus 与真实触摸两个入口都不弹键盘；符合规范语义（textarea 保持可编辑），理论上不阻断实体键盘。readonly 同样有效但作为备选放弃——它会阻断 iPad 实体键盘路径，而 inputmode=none 在 Android 实证通过，无需回退。
2. **锁定时序（探针⑤）：必须先 `blur()` 再设抑制属性**。仅改属性收不掉已弹出的键盘；blur+属性可靠收起（~300ms 内）。
3. **解锁时序**：清除抑制属性后，在用户手势（click handler）内 `term.focus()` 可正常弹键盘。
4. **键盘可见性检测**：`visualViewport` 差值 >150px 与系统 IME 状态一致，可驱动指示器（与设计文档 T-B「只驱动指示器、不参与迁移」一致）。
5. **IME 组合中锁定（探针②）：未测**——模拟器无法构造真实 IME 组合态。保守处理：锁定即 blur，组合内容按平台默认行为（触发 compositionend）处理，不做额外干预；列为真机可选验证项，不阻塞。

## 已知缺口

- **iOS Safari 未验证**（无设备）。设计文档决议：iOS 若不支持 inputmode=none 则全平台回退 readonly。增量 2 的 PR 真机闸门降级为「Android 模拟器 + 用户 Android 真机」，iOS 标 known-unknown，待有设备时补测再定是否回退。
- **实体键盘未验证**（无设备）。inputmode=none 按规范不影响实体键盘；若未来验证失败，按设计文档 Deferred 条目评估 hardware keyboard 检测。
- Chrome 124 偏老；inputmode 是 Chrome 66+ 的老特性，版本风险低，但增量 2 真机矩阵应覆盖用户真机的较新 Chrome。

## 增量 2 自动化测试复用要点（playwright `_android` 踩坑记录）

1. `device.launchBrowser()` 卡死（Chrome 首跑向导 + playwright socket 名不匹配）→ 弃用，改 `adb forward tcp:9222 localabstract:chrome_devtools_remote` + `chromium.connectOverCDP`。
2. CDP `Input.dispatchTouchEvent` 能触发 DOM 事件但 **Android IME 不响应** → 弹键盘相关触摸必须 `adb shell input tap`。
3. adb tap 坐标换算：`uiautomator dump` 取 Chrome toolbar_container 底边作为网页内容 top，CSS px × devicePixelRatio(2.625)。
4. 驱动脚本留档：`/tmp/remobi-kb-spike/drive-final.mjs`。
5. 模拟器调查结束后必须 teardown：执行 `adb emu kill` 并确认 qemu 退出；关闭：`/home/zlx/android-sdk/platform-tools/adb emu kill`；启动：`sg kvm -c '/home/zlx/android-sdk/emulator/emulator -avd remobi -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect'`。
