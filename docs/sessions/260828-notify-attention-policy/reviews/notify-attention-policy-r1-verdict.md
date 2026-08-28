# 出站注意力闸 R1 审查结论

risk-tier: personal
verdict: pass
review-range: `4bf0e98443f20403869e4ac50a132c4e83ebfb22..fb1d67e3f83ef5d10457d1ad97d86a10c84e7faf`

## 结论

固定范围 `base..H0` 兑现了历史与出站分离的注意力策略，没有个人级 P1 或 P2。

P1：无。

P1 两问：无 P1 finding，因此不存在需要判定的真实触发路径；也不存在由此产生的不可接受后果。

P2：无。

P3（不阻塞，接受不修）：

- `src/notify/service.ts:249-251` 新增 `unrefTimer` 目前只有一个调用方，且同文件已有同类内联逻辑；违反本卡反熵条款的“无第二消费者不新增抽象”约束。它不改变行为，可在后续整理时内联或统一复用。

## 不变式核验

- Spec 1：`src/notify/service.ts:308-320` 先对所有非 test 事件 append 历史，再做出站决策；silence 与 child done 仍写入 jsonl。
- Spec 2/3/7：`src/notify/attention-policy.ts:16-29` 明确放行 asking、health、test、ci-red、root done；silence 与 child done 记录 `skipped`，不记录会伪装成推送成功的 `accepted`。
- Spec 4：`src/notify/attention-policy.ts:12-14` 缺失 session 使用 `default`；`src/notify/service.ts:271-290` 按 session 保存最后一条并在每次新 unlabeled done 时重置 600 秒安静计时器。
- Spec 5：只有 `decideOutbound` 返回 `coalesce` 的无 role done 进入 `pendingCoalesce`；`src/notify/service.ts:293-299,341-343,366-370` 的排空不会拿到 child 或 silence。生产关停在 `src/serve.ts:1035-1040` 先 drain 再 dispose。
- Spec 6：`src/notify/events.ts:29-46,140-180` 接受 role/parentId/startedAt 的合法可选值，未知字段与非法值返回 400。
- Spec 8：diff 未新增 task_id 推断或命名规则。

## 独立证据

- `ocr-review` 返回 `status=reviewed`、`profile=minimax`、`coverage=complete`；6 条工具意见逐条核对后，只有 `unrefTimer` 形成上述 P3。其余意见分别是现有 spec 要求、类型收窄所需，或无当前触发路径。
- `pnpm exec vitest run tests/notify-attention-policy.test.ts tests/notify-service-drain.test.ts tests/notify-events.test.ts tests/notify-decision-log.test.ts tests/notify-health.test.ts tests/notify-push-delivery.test.ts`：6 files、106 tests 全部通过。
- `pnpm exec tsc --noEmit`：exit 0。
- H0 运行时探针混合 dispatch unlabeled done、child done、silence 后执行 `dispose` + `awaitInFlight`：历史 3 条，出站仅 pending unlabeled done 1 条。
- `git diff --check`：通过；审查对象 HEAD 确认等于 H0。
