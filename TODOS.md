# TODOS

Deferred work captured by review sessions. Each entry carries enough context to pick up cold.
Format: What / Why / Pros / Cons / Context / Effort / Priority / Depends on.

## E3 — ASR 热词/上下文注入（豆包 corpus context）

- **What:** 给豆包 ASR 请求注入热词/语料上下文（repo 名、agent 命令词表、常用路径），提高技术词汇识别准确率。
- **Why:** agent 指令场景中英混杂 + 技术词汇，裸识别错字率是影响体验的最大变量；豆包 bigmodel ASR 支持 `corpus.context`（volcengine docs 6561/1354869）。
- **Pros:** 识别准确率的真实杠杆；差异化于键盘听写的关键能力。
- **Cons:** 词表来源要设计（静态配置 vs 从 tmux/herdr 会话上下文自动提取）；自动提取有正确性风险。
- **Context:** 2026-08-19 CEO+eng review defer（见 `docs/designs/asr-voice-input.md` Scope Decisions E3）。`AsrEngine` 接口未为此预留参数——实现时扩展 doubao engine 的 full client request payload 即可，不动接口。建议先做静态配置词表（config `asr.doubao.hotwords`），自动提取另立卡。
- **Effort:** M（human ~1-2 天 / CC ~1-2h，含配置 schema + payload 接线 + 单测）
- **Priority:** P2
- **Depends on:** ASR 增量 1+2 落地（doubao engine 存在）

## E4 — Web Speech fallback provider

- **What:** `AsrEngine` 第二个实现：浏览器内置 `SpeechRecognition`/`webkitSpeechRecognition`，作为豆包不可用时的免费备胎。
- **Why:** iOS Safari 标签页场景下零配置可用；火山欠费/限流/网络不通时的降级路径。
- **Pros:** 零密钥零成本；provider 接口被第二个实现验证（接口设计是否健康的试金石）。
- **Cons:** iOS Safari 的 webkitSpeechRecognition 支持不稳、中文质量一般；识别走 Google/Apple 云端，隐私口径要在 README 写清。
- **Context:** 2026-08-19 CEO+eng review defer（E4）。config schema v1 把 `provider` 锁成 `'doubao'` 字面量（C11）——实现本项时扩 union 为 `'doubao' | 'web-speech'` 并加能力检测（`isSupported()` 接口已预留）。
- **Effort:** S（human ~0.5 天 / CC ~30min，接口同构）
- **Priority:** P3
- **Depends on:** ASR 增量 1+2 落地

## M6 — 远端结构化事件桥

- **What:** 为 explicit target 的远端 herdr/agent 提供经过身份校验的结构化事件入口，并把事件路由到对应 target。
- **Why:** 当前 `/api/events` 是 herdweb 主机 loopback 入口；`herdr --remote` 的终端输出可见，但远端 asking/done/ci-red 事件不会自动汇聚。
- **Pros:** 远端 target 的通知与本地 target 具备同等事件来源；保持通知 targetId 隔离。
- **Cons:** 增加跨主机认证、重放/断线语义和部署面；不能把 SSH 连接状态当成事件健康。
- **Context:** 多目标最终实现明确不做本项；先保持同机事件源和当前 single-v1/explicit-v2 契约，不预留代码接口。
- **Effort:** L（需单独评审、跨主机探针和安全边界）
- **Priority:** P2
- **Depends on:** 远端事件 producer、身份/传输方案和真实远端部署证据

## M7 — herdr session 自动发现

- **What:** 从本机或明确授权的远端 herdr 安全列出可选 session，辅助生成或更新 explicit targets。
- **Why:** 当前 target 必须由用户在配置中写出；自动发现尚未有稳定的跨主机权限和生命周期契约。
- **Pros:** 减少手工维护 session command 的成本，降低输入错误。
- **Cons:** 发现结果不是稳定身份；远端 SSH/权限失败、session 退出和重命名都需要可解释状态，不能静默改配置。
- **Context:** 当前实现只接受静态 `targets`，不扫描 socket、SSH argv 或连接进程推断远端状态；本项不预留代码接口。
- **Effort:** M（需先确定 herdr API、授权边界和持久化交互）
- **Priority:** P3
- **Depends on:** herdr session discovery API、明确授权模型和真实本机/远端探针
