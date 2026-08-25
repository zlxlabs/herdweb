# PR #112：herdweb d-pad UX R1 独立评审

- 审查范围：245c567..133ad07
- 结论：**fail**
- Findings 计数：**P1 2、P2 4、P3 1**

## Findings

### P1-1：长按/连发没有绑定到按下时的附件代际

- 严重性：P1；置信度：9/10
- 溯源：spec 2（attachment guard 语义）和 spec 5；同时命中 P1 红线“静默出错”。
- 位置：src/controls/dpad.ts:319-323、src/controls/dpad.ts:342-348
- 理由：长按回调、连发首发和 interval 直接调用 sendData(term, data)，没有捕获并检查按下时的 attachment guard。按住 d-pad 后切换 target/attachment，延迟输入会落到当前的新 target，而不是按下时的 target；用户看不到错误提示，结果是静默发送到错误会话。临时探针复现为按住右键时把 attachment 从 A 切到 B，350ms 后产生 ArrowRight，当前 attachment 已是 B。
- 建议修法：在一次 press 开始时捕获 attachment guard/generation；长按回调、连发首发和每次 interval 发送前都检查它，过期时停止本次 timer。对于 send 直通路径也要应用这个按下时的代际检查。

### P1-2：holdFired 在取消路径泄漏，导致下一次普通 tap 被吞掉

- 严重性：P1；置信度：9/10
- 溯源：spec 4、spec 5、spec 8（普通 tap 逐字节语义不变）；同时命中 P1 红线“数据丢失/静默出错”。
- 位置：src/controls/dpad.ts:306、src/controls/dpad.ts:326-330、src/controls/dpad.ts:351-362
- 理由：长按或连发 timer 触发后把 holdFired 设为 true；touchcancel、mouseleave、mouseup 等只清 timer，不清 holdFired。之后如果没有正常执行 onAttachmentTap（例如 attachment guard 拒绝了 release），这个状态会一直存在，下一次独立的短 tap 被 if (holdFired) 静默抑制。临时探针复现为 Enter 长按触发换行后 mouseleave，随后新的短 click 没有发送回车。
- 建议修法：把 hold 状态设为每次 press 的生命周期状态；在所有 end/cancel/leave 路径清理 timer 和 holdFired，新 press 开始时也重置；attachment 过期或拒绝 release 时不得把状态带入下一次 tap。

### P2-1：d-pad 收起后，活动 timer 仍会向终端发送输入

- 严重性：P2；置信度：9/10
- 溯源：spec 5（松开即停）和 spec 8（toggle/自动收起行为不回归）。
- 位置：src/controls/dpad.ts:319-355、src/controls/dpad.ts:368-380
- 理由：toggle() 关闭 d-pad 只切换 class，没有停止当前长按/连发 timer。临时探针按住 Down 后立即关闭 d-pad，350ms 后隐藏的 d-pad 仍发送了 ArrowDown。这会让用户在看不见控件时继续产生输入。
- 建议修法：集中保存当前 press 的 timer 清理函数，在 toggle() 收起时停止并清理；连接断开/自动收起路径也复用同一清理入口。

### P2-2：既有 closeComposerOverlays 行为被扩展为自动关闭 d-pad

- 严重性：P2；置信度：10/10
- 溯源：spec 8（toggle/自动收起等既有行为不变）。
- 位置：src/index.ts:326-333
- 理由：基线的 closeComposerOverlays() 只关闭 drawer 和 combo picker；本次改动加入 dpad.toggle()，因此连接状态变化和 mic controller 调用该函数时会额外隐藏 d-pad。这是超出本次 d-pad 必需范围的既有行为改变，且与用户当前是否正在使用 d-pad 无关。
- 建议修法：不要把 d-pad 加入已有的通用 composer overlay close 路径；若确实需要关闭，应建立明确的 d-pad 生命周期事件并由产品行为单独约定、测试。

### P2-3：新增测试无法通过 TypeScript CI gate

- 严重性：P2；置信度：10/10
- 溯源：无直接产品 spec；按“无法直接溯源默认降一级”处理，但命中仓库 CI 的 TypeScript gate。
- 位置：tests/dpad.test.ts:28-29
- 理由：querySelectorAll() 没有提供 HTMLButtonElement 泛型，返回的 Element[] 被直接返回为 HTMLButtonElement[]。pnpm exec tsc --noEmit 和 PR CI 均在此处失败，导致 PR 不能通过必需检查；pnpm test 通过并不能覆盖该编译检查。
- 建议修法：使用 element.querySelectorAll<HTMLButtonElement>(...)，或在测试 helper 中进行经过约束的类型转换，然后重新运行 TypeScript gate。

### P2-4：localStorage 的读取和复位删除路径没有 fail-safe 保护

- 严重性：P2；置信度：8/10
- 溯源：spec 6（位置持久化/复位）。
- 位置：src/controls/dpad.ts:123-139、src/controls/dpad.ts:219-225
- 理由：readDpadPosition() 的 storage.getItem() 在 try 外，dock() 的 localStorage.removeItem() 也未保护；而同文件的写入路径已经承认 Safari/iOS 私密模式可能抛异常并做了捕获。于是存储 API 不可用时，首次打开或双击复位可能直接从事件路径抛错，d-pad 打不开或不能复位。位置存储是增强能力，存储不可用不应破坏核心按键。
- 建议修法：对 getItem 和 removeItem 使用与 setItem 一致的窄范围捕获，并将其视为“不持久化但 d-pad 继续可用”。不要吞掉按键派发或其他核心错误。

### P3-1：happy-dom 的持久位置测试没有验证真实尺寸下的 clamp

- 严重性：P3；置信度：10/10
- 溯源：spec 6。
- 位置：tests/dpad.test.ts:491-492、tests/dpad.test.ts:582-590
- 理由：happy-dom 中 d-pad 的 getBoundingClientRect() 宽高为 0。临时探针使用越界存储位置时得到 rect={width:0,height:0}，最终 style 为 left:1024px; top:768px；这不能证明真实 d-pad（有非零尺寸）会完全留在视口内。纯 clampDpadPosition() 单测锁住了公式，正常布局的 Playwright 拖动也通过，但“下次打开时对越界持久位置 clamp”这个集成行为没有被有效锁死。
- 建议修法：在 happy-dom 测试中 mock 非零的 getBoundingClientRect()，或增加 Playwright 测试先写入越界位置再 reload，并断言真实 bounding box 完全位于 viewport 内。

## Spec 逐条对照

- spec 1：实现提供默认 9 格、null spacer 和整体替换；schema/config/单测覆盖基本正确。
- spec 2：普通 action 通过注入的 executeAction，context 包含 hooks、attachment guard、sendRawText；send 直通路径存在。但延迟直通发送没有按下时 attachment 代际检查，见 P1-1。
- spec 3：paste 经 {type:'paste'} 和 action context；clipboard API 缺失/reject toast、空剪贴板静默，单测覆盖，未发现本次新增缺陷。
- spec 4：短 tap、500ms 长按、mouse/touch 路径和 Enter 抑制测试基本覆盖；取消后 hold 状态泄漏，见 P1-2。
- spec 5：300ms 首发、100ms interval、长按优先和 repeat 后抑制 tap 的正常路径有测试；跨 attachment、收起和取消时序不安全，见 P1-1、P1-2、P2-1。
- spec 6：拖动 clamp、存储、复位有实现和正常路径 e2e；存储 API 异常未保护，且 happy-dom 的非零尺寸 clamp 集成断言失真，见 P2-4、P3-1。
- spec 7：按键和手柄均抑制合成 mousedown，happy-dom touch/focus 测试和 Playwright 交互通过，未发现本次回归。
- spec 8：普通 tap 的正常路径通过；closeComposerOverlays() 新增关闭 d-pad，以及收起后 timer 继续发送，见 P2-1、P2-2。

## 熵增与测试真实性

- DpadConfig、共享 ControlButton.longPressAction/repeatOnHold 字段、schema 和 projection 都有本次功能的真实消费者，不以“未来可能复用”为理由新增无消费者抽象；未将其单列为 finding。
- happy-dom 的尺寸断言确实受零 DOMRect 影响，已单列 P3-1；Playwright 的 d-pad 正常拖动、长按、连发和 clipboard 场景使用真实浏览器行为，均通过。
- 主要时序缺口是 timer 生命周期、attachment 代际和取消后的 tap 抑制，均用临时探针复现，而非只依据静态推测。

## Backlog / 非本次 findings

- Open issue #99（paste 高频键位）和 #98（输入换行）是本 PR 的既有需求背景，本评审不重复计为独立存量缺陷；本报告只记录 PR 实现仍留下的时序问题。
- lint:ox 报告的 14 条 warning 位于既有 mic/ASR/legacy 代码，不在本次 d-pad diff 内。
- Playwright 的两个失败是既有 [chromium-android] 场景：tests/playwright/notify.spec.ts:23 和 tests/playwright/touch.spec.ts:149 的 page.goto 超时；本次新增 d-pad e2e 均通过，故不计入 d-pad findings。

## 验证命令与结果

- pnpm test：通过，73 files / 1139 tests passed。
- pnpm run check：通过，Biome 188 files 无改动。
- pnpm run lint:ox：退出码 0，14 条 warning，均为既有非 d-pad warning。
- pnpm run lint:knip：通过，无 unused exports/files。
- pnpm run test:pw：退出码 1；110 tests 中 100 passed、8 skipped，2 个非 d-pad 的 chromium-android page.goto 超时；新增 d-pad e2e 全部通过。
- pnpm exec tsc --noEmit：失败，tests/dpad.test.ts:29 的 Element[] 不能赋给 HTMLButtonElement[]。
- gh run view 32841953737 --job 97783213629 --log-failed：PR CI 同样在 pnpm exec tsc --noEmit 的 tests/dpad.test.ts:29 失败。
- git diff --check 245c567..133ad07：通过。
- 评审工作树最终状态：clean，无源码修改、无 commit。

## 结论

结论：**fail**。本次 PR 有 **2 个 P1、4 个 P2、1 个 P3**；至少需修复两个 P1 和 TypeScript CI 阻塞后再进入下一轮评审。

