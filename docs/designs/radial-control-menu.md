# 设计记录：触点径向（饼）菜单——观察与搁置结论

**状态**：已评估，搁置（2026-09-19 用户判定「意义不大」，仅存档备查）
**日期**：2026-09-19
**Base**：416b573

## 观察

外部视频（本机文件、未入库；写主 checkout 的绝对路径，免得在新 worktree / 克隆里悬空：
`/home/zlx/projects/oss/herdweb/tmp/memory1789826465040.mp4`，约 10s）：手机单手操作 herdr TUI 里的
OpenAI Codex CLI，长按/点按终端内容区后**在触点处弹出径向菜单**——8 个小圆钮
（麦克风、Agent logo、键盘、撤销、⌘、Tab、历史、^）围绕手指等距排开；点键盘图标
唤起软键盘；随后出现第二层径向菜单（d-pad + ⌫ + ⏎）。

herdweb 无此能力（`src/controls/` 为 toolbar / floating d-pad / drawer 体系）。

## 第一性原理分析

手机上单手驱动 agent 的操作成本 = 拇指位移（Fitts 定律）+ 视觉搜索 + 姿态切换。
高频信号集合很小（⏎ / Esc / C-c / ↑ / Tab / Ctrl 系 / 语音 / ⌨），恰好 ≤8 个。

饼菜单的理论优势（Callahan et al. 1988；Kurtenbach & Buxton marking menus）：

- 所有选项与触点**等距**，位移趋近于零——toolbar 是「手指走到键上」，饼菜单是
  「键送到手指下」；
- 方向选择可**肌肉记忆化**，熟练后不看屏幕可盲划——常显 toolbar 在原理上做不到；
- 实证：≤8 项时比线性菜单快约 15%、错误率更低，8 项正好卡在甜区上限。

代价（同样源于原理）：

- 可发现性差——藏在手势后面；
- **遮挡**——菜单正好盖住正在看的内容（视频中全程压字）；
- 边缘溢出——触点靠近屏幕边缘时圆摆不下；
- 手势冲突——长按在终端已有语义（滚动、select mode）。

## 对照 herdweb 现状

两者是**同一哲学**（软键盘是逃生舱，高频键外置）的不同几何：herdweb 用常显
toolbar + floating d-pad + 手势解决同一问题。径向菜单对「单手大屏、躺姿」场景
在原理上严格更优，但 toolbar 方案没有原理性缺陷——**这是优化项，不是补缺陷**。

视频中第二层径向 d-pad 与 herdweb 已有 floating d-pad 功能重复，且压在软键盘上，
明确不学。

## 若未来重启，边界已定

- 架构兼容：统一 `ControlButton` schema 下径向菜单只是**第四种渲染器**
  （toolbar/drawer/floating 之后），不动数据模型、不加新 action 类型；
  `src/gestures/long-press.ts` 现成。
- 形态：≤8 项、只放最高频键（Esc / Tab / ↑ / ⏎ / Ctrl / ⌨ / 🎤），长按或边缘
  轻扫触发。
- 必须先解决的硬问题：触发手势与 select mode 长按、终端滚动的冲突；径向层对
  scrollback 的遮挡。
- 验证方式：真机与 toolbar 对比到达成本，用数据决定去留，不凭感觉立项。
