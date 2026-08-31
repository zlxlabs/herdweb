# Chromium navigation remain R1 H0 verdict: PASS

## 审查范围

- 固定对象：`f22d4be3fefa8fa7246b1ef71015fc958eeb8e9a..5631806aabeba07b315b6c36c0276711d1633548`
- 风险等级：`personal`；本次 P1 只包含数据丢失、静默出错、崩溃。
- 对照设计：`docs/sessions/herdweb-e2e-flake/design.md` 不变式 2。
- 本 verdict 不追踪上述 H0 之后的任何提交。

## 新证据

1. 本轮独立 OCR 前置扫描返回 `status=reviewed`、`profile=minimax`、`coverage=complete`、`findings=[]`、`cli_status=complete`。
2. H0 诊断文档记录了当前主干上的 trace：首屏字体 CSS 请求为 pending、HAR `time=-1`，且 `page.goto` 一直等待 `load`；这满足先有 hang trace 和 pending URL 的前置条件。
3. H0 验证文档记录了 10 轮串行 JSON walk：kind (a) 从基线 14 降至 1；剩余 1 个是 `notify.spec.ts:23` 的 Chromium body timeout，不是字体 CSS 导航超时。

## 不变式 2 核验

| 检查项 | 证据 | 判定 |
| --- | --- | --- |
| 首屏 HTML 不含字体 `rel="stylesheet"` | H0 `build.ts:185-204` 删除首屏字体 link；`renderClientHtml` 只输出内联应用 CSS。`tests/integration.test.ts:492-507` 和 `tests/client-config-projection.test.ts:79-83` 断言 head 不含 stylesheet、字体标记和 CDN URL。 | 通过 |
| 客户端只在 `load` 之后注入 | H0 `src/client-entry.ts:38-53` 先注册 `load` 监听器，或仅当 `document.readyState === "complete"` 时立即执行；实际 `appendChild` 在 `apply` 内。`main` 在 `src/client-entry.ts:257-258` 只调度该函数。 | 通过 |
| CSS 永不回包不阻塞 `page.goto({ waitUntil: "load" })` | H0 `tests/playwright/font-stylesheet.spec.ts:3-15` 用 `context.route` 将字体 CSS 保持 pending，并以 `waitUntil: 'load'` 导航后继续断言终端可见；10 轮结果也未出现字体 CSS 导航 kind (a)。 | 通过 |
| 先 trace、再只改一件事，且成功标准是 kind (a) 下降 | `chromium-nav-remain.md` 记录了修改前 trace 和 pending URL；产品行为只有移除首屏 link、改为 load 后注入；10 轮 kind (a) 为 1，低于基线 14。 | 通过 |

## 失败路径与熵审查

- 若字体 CSS 一直 pending，它已不在文档解析和 `load` 的资源集合中；load 事件完成后才创建 link，因此不会重新阻塞本次导航。
- 动态 link 仍使用 `rel="stylesheet"`、`media="all"` 和原配置 CDN URL；服务端 CSP 的 `style-src` 明确允许 `https:`，没有引入被 CSP 静默拦截的内联 `onload`。
- `scheduleDeferredFontStylesheet` 是原有单一字体处理函数为两个时序分支的直接改写；没有新增配置、状态、重试、fallback 或通用包装层，不构成无第二消费者的熵增抽象。

## Findings 分诊

| 来源 | 工具标注 | 本仓判定 | P1 两问 |
| --- | --- | --- | --- |
| OCR 前置扫描 | 无 finding | 无 finding | 不适用 |
| 人工 H0 审查 | 无 finding | 无 P1/P2/P3 | 不适用 |

剩余的 1 个 kind (a) 已由 H0 文档归因为通知测试 body timeout，并非本次字体导航路径；按不变式 2 的“kind (a) 下降”成功标准，不阻塞本 H0 合入，也不把漏斗仍脏写成 P1。

## 结论

**PASS：H0 满足 DESIGN-note 不变式 2，可以合入。**
