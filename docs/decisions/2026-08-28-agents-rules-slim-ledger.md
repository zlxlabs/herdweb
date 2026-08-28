# 2026-08-28 AGENTS.md 规则瘦身核销表

**Status:** Draft (commit 1 of rules-slim)
**Base:** `a3a29e880d516ebb34c5cc2bbf8a2e0d7ba73da2`
**源文件:** 仓根 `AGENTS.md`（13837B）；`CLAUDE.md` 为指向它的软链，本卡不动软链。
**配方:** [规则文件预算 · 三问准入](/home/zlx/projects/personal/agent-config/docs/guides/rules-budget.md)

三问：这条每个会话都需要吗？能从代码/README/git log 推断吗？现在还成立吗？不全过则搬 `docs/` 留指针或删除。拿不准的标「保留」并注明存疑。

## 对账

| 口径 | 数量 |
|---|---|
| 原二级标题 (H2) | 8 |
| 原三级标题 (H3) | 1 |
| **原标题合计（完成条件口径）** | **9** |
| 核销表「标题级」行（覆盖全部 H2/H3） | 9 |
| 文首无独立标题的约束行 | 3 |
| Module Layout 未标号子段 | 3 |
| Conventions 子弹 | 15 |
| **核销表全表行** | **30** |

原标题清单（按文件顺序）：

1. `## Architecture`
2. `## Stack`
3. `## Key Commands`
4. `## Local Development`
5. `### Production / Debug`
6. `## Conventional Commits`
7. `## Module Layout`
8. `## Publishing`
9. `## Conventions`

H1 `# herdweb` 无独立二级标题，其下 3 条约束行另表核销，不计入「原标题合计」。

## 标题级核销（覆盖全部 H2/H3）

| # | 原条目 | 处置 | 理由 |
|---|---|---|---|
| H2-1 | `## Architecture` — Pure TypeScript + DOM API, no framework | 保留 | 三问全过：每个改代码的会话都需要「无框架」硬约束；无法从单文件一眼推断；现在仍成立。 |
| H2-2 | `## Stack` — Node 22+ / pnpm / esbuild / tsdown / vitest / Biome / happy-dom / Hono / node-pty / xterm.js | 搬 `docs/architecture/stack.md` 留指针 | 问 1 不过：不是每个会话都要完整工具清单。问 2 不过：`package.json` 可推断。仍成立，故搬不删。 |
| H2-3 | `## Key Commands` — hooksPath、test、test:pw、check、check:fix、lint:knip、lint:ox、build、build:dist | 保留 | 三问全过：每个写代码会话都要跑这些命令；README `### Checks` 缺 `lint:knip` / `lint:ox` 且未写明 `check` 盖不住 oxlint（陷阱）。本卡不补 `tsc --noEmit`（不改语义；open issue #117）。 |
| H2-4 | `## Local Development` — `tsx cli.ts serve` 与 `build:dist` 两条启动路径 | 搬 `docs/architecture/local-development.md` 留指针 | 问 1 不过：不是每个会话都要启动服务。问 2 不过：README `## Development` / Quick start 已有同类命令。仍成立，故搬不删。 |
| H3-1 | `### Production / Debug` — 指向 `docs/deploy-herdr.md` | 搬（并入 `docs/architecture/local-development.md`，与父节一起原样搬） | 问 1 不过：部署不是每个会话都需要。原文已是指针；搬后仓根 Local Development 指针覆盖此 H3。不另删。 |
| H2-5 | `## Conventional Commits` — 格式、类型表、`BREAKING CHANGE` footer、**NEVER use `fix` for non-consumer-facing** | 保留 | 三问全过：每个会提交的会话都需要；「`fix` 会触发 npm 发布通道」无法从 git log 推断；现在仍成立。 |
| H2-6 | `## Module Layout` — overlay / server / CLI 文件地图（6054B） | 搬 `docs/architecture/module-layout.md` 留指针 | 问 1 不过：不是每个会话都要文件级地图。问 2 不过：目录树可推断。仍成立，故搬不删。未标号子段随父节整段原样搬（见下表）。 |
| H2-7 | `## Publishing` — 不发 npm、tsdown 产物、`files`、CI、semantic-release 通道 | 搬 `docs/architecture/publishing.md` 留指针 | 问 1 不过：发布细节不是每个会话都需要。问 2 不过：README `## Release channels` 与 `.github/workflows/ci.yml` 可推断。仍成立，故搬不删。提交类型→发版映射已由保留的 Conventional Commits 覆盖。 |
| H2-8 | `## Conventions` — 控件/配置/视口/测试/技能等硬约束列表 | 保留（子弹拆行，见下表） | 节本身是硬约束集合。问 1 对大多数子弹为是。视口长段问 1 不过，单独搬。 |

## 文首（H1 下无独立标题）

| # | 原条目（首行摘要） | 处置 | 理由 |
|---|---|---|---|
| P-1 | Purpose-built Web UI for herdr — monitor and drive coding agents from your phone | 保留 | 三问全过：每个会话都需要项目一句话定位。 |
| P-2 | `risk-tier: personal` | 保留 | 锁定决策：必须原样保留。每个会话的评审红线都读这一行；无法从代码推断。 |
| P-3 | Fork status: forked from connorads/remobi, independent since 2026-08-20, not tracking upstream, not published to npm | 保留 | 三问全过：不跟踪 upstream / 不发 npm 是易违反的仓级约束；决策正文已在 `docs/decisions/2026-08-20-fork-herdr-focus.md`，仓根只留现有两行。 |

## Module Layout 未标号子段

随 `## Module Layout` 整段搬到 `docs/architecture/module-layout.md`，不在仓根拆条。

| # | 原条目 | 处置 | 理由 |
|---|---|---|---|
| ML-1 | Browser overlay (bundled to the client via esbuild) — `src/client-entry.ts` 起的 overlay 文件地图 | 搬（随父节） | 同 H2-6：问 1 / 问 2 不过。 |
| ML-2 | Server runtime (`herdweb serve`, Node) — `src/serve.ts` / `session.ts` / protocol / base-path | 搬（随父节） | 同 H2-6。 |
| ML-3 | CLI + build — `cli.ts` / `build.ts` / overlay 构建 / commit-message / `styles/base.css` | 搬（随父节） | 同 H2-6。 |

## Conventions 子弹

| # | 原条目（首行摘要） | 处置 | 理由 |
|---|---|---|---|
| C-1 | Button actions use discriminated unions (`type: 'send' \| … \| 'notify-panel'`) | 保留 | 三问全过：改按钮/配置必碰；类型在 `src/types.ts` 但会话需要显式名单才不会顺手加新 type。 |
| C-2 | Unified control schema: `ControlButton` for toolbar and drawer | 保留 | 三问全过：双渲染器共用类型，易被拆成两套。 |
| C-3 | Config shape: `drawer.buttons` (not `drawer.commands`) | 保留 | 三问全过：旧字段名是已知陷阱。 |
| C-4 | Config via `defineConfig()` — typed, with sensible defaults | 保留 | 三问全过：配置入口约定。 |
| C-5 | Config resolution: `--config` → cwd → `~/.config/herdweb/`（XDG；legacy upstream 自动回退） | 保留 | 问 2 部分过：`docs/configuration.md## Config resolution` 已有更全文。仍保留一行：legacy 回退是易踩陷阱。不删。 |
| C-6 | Drawer takes a flat `readonly ControlButton[]`，section 变化时插入 heading 行 | 保留 | 三问全过：抽屉渲染契约。 |
| C-7 | Help overlay is config-driven and must be fail-safe | 保留 | 三问全过：help 失败不得打断核心控件。 |
| C-8 | Mobile viewport handling: lock document scroll；`--kb-inset` / `--wt-toolbar-height`；target picker 布局 | 搬 `docs/architecture/mobile-viewport.md` 留指针 | 问 1 不过：CSS 变量与 picker 布局细节不是每个会话都需要。问 2 不过：实现在 `src/viewport/height.ts` 与 `src/controls/target-picker.ts`。仍成立，整段原样搬，不拆写。 |
| C-9 | Changelog and versioning fully automated by semantic-release — do not manually edit `CHANGELOG.md` | 保留 | 三问全过：与 Conventional Commits 的类型表互补；类型表不写「禁止手改 CHANGELOG」。不删。 |
| C-10 | All DOM creation in `util/dom.ts` helpers | 保留 | 三问全过：禁止会话里手写 `createElement` 散落。 |
| C-11 | Keyboard state preserved: `isKeyboardOpen()` then `conditionalFocus()` | 保留 | 三问全过：手机键盘主权，易被新控件打破。 |
| C-12 | Tests use happy-dom（e2e/CLI 用 node environment） | 保留 | 三问全过：测 DOM 的默认环境约定。 |
| C-13 | Agent skill: `.agents/skills/herdweb-setup/SKILL.md`；配置/CLI/action/校验变更时同步 | 保留 | 三问全过：改配置面必须同步 skill。 |
| C-14 | Agent onboarding: 帮用户搭建（不是开发）时读并遵循 herdweb-setup skill | 保留 | 三问全过：用户向会话的入口纪律。 |
| C-15 | Voice input: toolbar-only；`asr.enabled` + HTTPS（localhost 除外）+ `.local` key；drawer/floating 非法 | 保留 | 三问全过：放置约束是已知陷阱。 |

## 拟新建文档（commit 2 落盘，正文原样搬）

| 新路径 | 承接条目 |
|---|---|
| `docs/architecture/stack.md` | H2-2 Stack |
| `docs/architecture/local-development.md` | H2-4 Local Development + H3-1 Production / Debug |
| `docs/architecture/module-layout.md` | H2-6 Module Layout（含 ML-1..3） |
| `docs/architecture/publishing.md` | H2-7 Publishing |
| `docs/architecture/mobile-viewport.md` | C-8 Mobile viewport handling |

不并入既有 `docs/` 文件：上述条目没有「天然该追加进某一现有段落」的对应节（`docs/configuration.md` 的 Config resolution 比 C-5 更全，C-5 留仓根一行，不追加）。`docs/architecture/how-herdweb-works.md` 的 “Where the code lives” 是另一套较新的运行时地图，与 Module Layout 全文不是同一份，禁止改写既有段落去合并。

## 删除清单

无。本卡不删条目；三问不过的全部搬 `docs/` 留指针。

## 保留条目排版

commit 3 重写仓根 `AGENTS.md` 时：保留条目原文不改语义；搬走的标题位留一行路径指针；C-8 在 Conventions 列表里改为一行指针。允许的排版级合并仅限：Local Development 与其 H3 共用一个指针行（H3 原文随父节搬到同一文档）。
