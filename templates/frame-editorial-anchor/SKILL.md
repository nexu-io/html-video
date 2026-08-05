---
name: frame-editorial-anchor
zh_name: "瑞士网格数据帧"
en_name: "Editorial Anchor Frame"
emoji: "📊"
description: "Swiss-grid statistic anchor — giant number, red accent, growing bars, black data bar. Rational and editorial."
zh_description: "瑞士网格数据帧:巨大数字锚点 + 红色强调 + 生长条形图 + 黑色数据底栏, 理性克制的编辑风"
en_description: "Swiss-grid statistic anchor — giant number, red accent, growing bars, black data bar. Rational and editorial."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 8
tags: ["stat", "swiss-grid", "editorial", "data", "number", "anchor", "frame"]
example_id: sample-frame-editorial-anchor
example_name: "瑞士数据帧 · 27"
example_format: markdown
example_tagline: "巨大红黑数字 + 瑞士网格 + 生长条形图"
example_desc: "单一关键指标锚点 + 网格线扫入 + 黑色数据底栏滑入"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Swiss-grid editorial (MIT)"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/alchaincyf/huashu-design"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Editorial Anchor Frame template to turn my key metric into a Swiss-grid data reveal — a giant number anchor, red accent, growing bar chart, and a black data bar. Preserve the template's visual signature, use real numbers, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「瑞士网格数据帧」模板把我的关键指标做成一段瑞士风数据揭示:巨大数字锚点 + 红色强调 + 生长条形图 + 黑色数据底栏。保持模板的视觉签名,使用真实数字,避免 lorem ipsum 和占位图片。"
---

【模板: 瑞士网格数据帧 (Editorial Anchor)】
【意图】单一关键指标 / benchmark 揭示 / 编辑风数据页。视觉提炼自 huashu-design 的瑞士网格编辑向 showcase (MIT, © alchaincyf)；L1 灵感见 provenance.origin，勿用工作室名当模板名。

【画布】1920×1080, 纯白底 `#ffffff`; 叠瑞士网格 — 水平/垂直细线 (黑, opacity 0.04-0.06), 开场 0.7s 内 scaleX/scaleY 从 0 扫入。

【字体】西文 `Archivo` (900/700/500) 或 `Helvetica Neue`; 中文 `Noto Sans SC` Bold。理性、紧凑、负字距。

【主结构 (时间轴, 默认 4s)】
- **0.0-0.7s** 网格线扫入 (scaleX/scaleY 0→1, cubic-bezier(0.16,1,0.3,1))。
- **0.5-1.6s** 右侧巨大数字锚点 (font-size ~1020px, weight 900, 黑, opacity 0.07) 从下方 8% 升入并淡现, bleed off 右边缘。
- **0.7s** 红色 eyebrow label (uppercase, letter-spacing 6px, `#E63946`) fadeUp。
- **0.85s** 主数字 headline (~200px, weight 900) fadeUp; 句点/单位用 `#E63946` 红强调。
- **1.15s** 副标 (24px, `#999`) fadeUp。
- **1.3s** 红色 center rule (高 5px) 从宽 0 → 400px 生长。
- **1.35-1.7s** 5 根条形图错峰从底部 scaleY 0→1 生长; 中间一根 `#E63946` 红 + opacity 0.85, 其余黑 opacity 0.12。
- **1.5s** 黑色数据底栏 (高 80px) 从 translateY(100%) 滑入; 内含 3 组 stat (红色大数字 + 灰白小标签) + 右侧 system 标签。

【配色纪律】仅用 黑 / 白 / `#E63946` 红 / 中性灰 `#999`。**严禁**其他彩色。红色是唯一强调色, 用在 label / 主数字标点 / center rule / 中间条 / 数据底栏数字。

【内容纪律】
- 必须用用户的真实指标/数字, 严禁 lorem ipsum 或编造 benchmark。
- headline 是一个数字 (≤12 字符); anchor 是它的简写 (≤4 字符) 用作背景巨字。
- 动效用 `@keyframes`, `prefers-reduced-motion` 下全部停在终态 (静态成图)。
- 单文件 HTML。
