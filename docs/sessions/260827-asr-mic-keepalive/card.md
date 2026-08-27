# 任务卡：iOS PWA 麦克风常驻采集，消除每次语音输入的权限弹窗

## 目标

在 iOS 主屏幕 PWA（standalone）模式下，两次语音输入之间不再每次弹出麦克风权限申请。
手段：麦克风 MediaStream 在首次 `getUserMedia` 后常驻，录音会话之间只暂停采集/发送，
不 `track.stop()`；释放只发生在 controller dispose / 页面卸载 / track 死亡后重建。

## 非目标

- 不改变非 iOS-standalone 环境的任何行为（桌面浏览器、Android、iOS Safari 标签页维持现状：
  每次 stop 释放麦克风）。
- 不新增用户配置项。
- 不改 ASR 协议、Doubao WebSocket 交互、composer UI 交互。
- 不处理「PWA 杀掉重开后首次仍要授权」——这是 iOS 平台限制，无解，不在本卡范围。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：300
- **Diff-Lines-Hard**：450
- **阶段**：implementing
- **锁定决策**：
  - 常驻采集只在 iOS standalone PWA 启用；检测方式用 `navigator.standalone === true`
    （iOS 专有不标准属性，其他平台为 undefined，天然满足「其他环境零变化」）。
  - 不新增配置项（无第二个消费者）。
  - 录音间隔麦克风指示灯常驻是已接受的代价（用户已明确确认）。
  - `AsrEngine` 对外的 `start()/stop()` 语义不变：stop 仍表示「结束本次识别、停止向
    provider 发流」；内部实现改为按需保留采集资源。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：3254576ce512af18cd46cf274ad37f9f41ffd98e
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：delegate 分配的执行器
- **计划者与审查者**：kimi 主脑拆卡并验收；review 循环另行派卡

## 修改边界

- **允许**：
  - `src/asr/doubao/engine.ts` — `BrowserPcmCapture` 的 start/stop 资源生命周期
  - `src/controls/mic-controller.ts` — 构造 `DoubaoEngine` 时传入 keep-alive 开关（检测点）
  - `tests/asr-engine.test.ts` — 新增 keep-alive 行为测试
  - `AGENTS.md` — 若 `src/asr/` 模块语义描述因本卡变化，同步对应行
- **禁止**：
  - `src/asr/worklet-entry.ts`、`src/asr/pcm.ts`、`src/asr/doubao/protocol.ts`
  - `src/asr/types.ts`（`AsrEngine` 接口不变；如认为必须改，在 report.md 显式提出并停下）
  - `src/config.ts`、`src/config-schema.ts`（不加配置项）
  - `.github/workflows/`
- **Scope-Globs**：src/asr/doubao/engine.ts src/controls/mic-controller.ts tests/asr-engine.test.ts AGENTS.md
- **高风险区域**：`BrowserPcmCapture.stop()` 当前承担「释放全部采集资源」职责，改为保留后，
  epoch/代际守卫（`this.epoch`）、`stopPromise` 串行化、mute/interruption 信号挂接都要在
  「复用旧流」与「流死亡后重建」两条路径上各自成立。

## 约束与假设

- **约束**（违反即拒收）：
  - keep-alive 关闭（非 iOS standalone）路径行为与现状完全一致 —— 检查：`tests/asr-engine.test.ts`
    现有断言不修改、全绿（只允许新增测试用例；若确实必须改既有断言，在 report.md 逐条说明理由，
    由主脑验收时裁决）。
  - keep-alive 开启时，`stop()` 不得调用 `track.stop()`、不得 close `AudioContext`；下一次
    `start()` 不得再次调用 `getUserMedia`（流仍存活时）—— 检查：新增测试用注入的 fake capture
    / mock getUserMedia 断言调用次数与 track.stop 未发生。
  - 流死亡（`track.readyState === 'ended'`，含录音间隙被系统回收）后下一次 `start()` 必须重新
    `getUserMedia` 重建，不得复用死流 —— 检查：新增测试覆盖。
  - `pnpm test`、`pnpm run check`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿。
- **假设**（执行器可自行调整，调整须在 report.md 写明理由）：
  - 录音间隙降低功耗的具体手段（`AudioContext.suspend()` / 断开 source+node / worklet 静音）
    由执行器选，满足「间隙不发 PCM、不占 WS」即可。
  - 常驻资源的挂接位置（`BrowserPcmCapture` 内部加模式位，或包一层）由执行器定。

## 不变式轴表

轴：采集流状态 × 事件

| 采集流状态 | 事件 | 期望 | 检测点 |
|---|---|---|---|
| 存活（keep-alive 开） | 一次完整 start→stop→start | 仅 1 次 getUserMedia，stop 不 stop track | 单测：mock getUserMedia 调用计数 = 1 |
| 存活（keep-alive 开） | stop 后间隙 > 任意时长再 start | 无新 getUserMedia，间隙无 PCM 发送 | 单测 |
| 死亡（track ended） | 下一次 start | 重新 getUserMedia 成功重建 | 单测：fake track readyState='ended' |
| 存活（keep-alive 开） | controller dispose / engine 不再使用 | track.stop 被调用、context 关闭（资源不泄漏） | 单测 |
| keep-alive 关 | 一次完整 start→stop→start | 2 次 getUserMedia、每次 stop 释放（现状） | 既有测试原样通过 |

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：iOS PWA 实机验证「连续两次语音输入、间隔 >1 分钟，第二次不再弹权限申请」
  由主脑/用户在真机上完成，[人工裁决]，执行器不负责；执行器交付的是上表全部格子的单测证据。
- **相关测试**：`pnpm test`（仓级全量入口，禁止 `-k`/子集过滤）；新增用例必须覆盖轴表全部格子。
- **跨发布边界不适用**：改动在同一浏览器进程内，无序列化/发布边界。
- **lint / typecheck / build**：`pnpm run check`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿。
- **截图或探活**：不需要（实机验收在主脑侧）。
- **现场还原**：收工时 checkout 停在 delegate 分配的 card 分支；不得动共享 checkout。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  本卡具体节奏：按「keep-alive 实现 → 轴表单测 → lint/全量测试收尾」至少分 3 次提交。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **红验有效性**（固定条款，原样保留）：反向验证的转红输出必须原文贴进报告，且红的类型
  必须是断言失败——撞出 ImportError / SyntaxError 说明注入方式坏了，必须换最小注入重验；
  默认用「只改判据本身那一行」。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个
  二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，
  从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md
  正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 诊断结论（本会话已查实）：iOS standalone PWA 下 `getUserMedia` 授权不持久化，且
    「capture 停止后约 1 分钟无活动，下次 getUserMedia 重新弹窗」——WebKit bug
    https://bugs.webkit.org/show_bug.cgi?id=215884 评论中 youenn fablet（WebKit 工程师）确认：
    "If capture is not ongoing, prompt should happen again after 1 minute of inactivity."
    同 bug 下 iOS 16.3.1 用户实测确认 standalone 模式间隔超 1 分钟即重复弹窗。
  - 现状代码：每次录音 `engine.start()` → `BrowserPcmCapture.start()` 调
    `getUserMedia({audio: true})`（`src/asr/doubao/engine.ts:168`）；`stop()` 停掉全部
    track 并关闭 AudioContext（`src/asr/doubao/engine.ts:315-343`，track.stop 在 :331）。
  - 既有 interruption 处理：`installCaptureSignals`（engine.ts:272-293）挂
    track.onended/onmute(5s 超时)/onunmute 与 context.onstatechange，报 `audio-interrupted`；
    keep-alive 后间隙期这些信号已清除，重建判定以 `track.readyState` 为准。
  - `DoubaoEngine` 唯一构造点在 `src/controls/mic-controller.ts:98`（无 engine 注入时）。
- **机理/根因陈述**：
  - `每次录音都是一次全新 capture 会话`（证据锚点：`src/asr/doubao/engine.ts:168`、`:331`）。
  - `iOS standalone 模式 capture 停止 ~1 分钟后权限重置`（证据锚点：上述 WebKit bug 评论）。
- **已完成**：根因诊断与用户方案确认（常驻采集 + 指示灯代价已确认接受）。
- **未完成**：全部实现与测试。
- **关键决策**：见「锁定决策」。
- **已否决方案**：
  - 加用户配置项控制 keep-alive —— 无第二个消费者，违反反过度设计红线。
  - 全平台常驻 —— 桌面端权限本来持久，常驻指示灯纯属副作用。
  - 用户侧引导（Safari per-site 授权）—— 对 PWA 不生效，已证实无解。
- **修改文件**：暂无。
- **测试及结果**：暂无。
- **已知问题**：PWA 杀掉重开后首次使用仍会弹一次权限（平台限制，无法消除）；iOS 退后台
  系统可能回收/静音麦克风，回前台后若 track 已死，下一次 start 会重新 getUserMedia 并可能
  再弹一次——按轴表「死亡」格处理即可，属预期。
- **下一步唯一动作**：按轴表实现 keep-alive 采集并补齐单测。
