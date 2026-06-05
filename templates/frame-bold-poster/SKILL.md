---
name: frame-bold-poster
zh_name: "大胆海报帧"
en_name: "Bold Poster Frame"
emoji: "🟥"
description: "A 1970s European editorial poster in motion — a red rule draws across, a giant tilted figure drops in, a three-line headline rises line-by-line, an italic serif standfirst fades."
zh_description: "大胆海报帧:1970s 欧洲社论海报风 + 番红强调色 + 巨型倾斜 Shrikhand 大字 + 三行标题逐行升起 + 衬线斜体副题, 印刷质感强。"
en_description: "A 1970s European editorial poster in motion — a red rule draws across, a giant tilted figure drops in, a three-line headline rises line-by-line, an italic serif standfirst fades."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["poster", "editorial", "bold", "serif", "red", "print", "manifesto", "frame"]
example_id: sample-frame-bold-poster
example_name: "大胆海报帧 · Manifesto"
example_format: markdown
example_tagline: "番红 + 墨黑 + 巨型倾斜大字"
example_desc: "品牌宣言 / 社论开场 — 红线划入 + 大字旋转落入 + 三行标题逐行升起"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Bold Poster (MIT)"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/zarazhangrui/frontend-slides"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Bold Poster Frame template to open my deck like a magazine cover — a mono kicker with a red rule drawing across, a giant tilted display figure, a three-line headline rising line-by-line (the middle line in red), and an italic serif standfirst. Preserve the template's print-poster signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「大胆海报帧」模板把我的开场做成杂志封面感:mono kicker + 红线划过 + 巨型倾斜大字 + 三行标题逐行升起(中间行番红)+ 衬线斜体副题。保持印刷海报的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 大胆海报帧 (Bold Poster)】
【意图】品牌宣言 / 愿景陈述 / 社论或文化类开场 — 让几个词像杂志封面一样落地。视觉提炼自 frontend-slides 的 Bold Poster 模板 (MIT, © Zara Zhang),其上游灵感为 1970s 欧洲社论海报 / 意大利体育杂志 / 中世纪品牌年报。

【画布】1920×1080, 暖白纸底 `#F5F2EF`。

【字体】display + 数字 `Shrikhand` (海报级斜体大字); body `Libre Baskerville` (衬线, 斜体副题); mono 标签 / chrome `Space Grotesk`。

【配色纪律】纸白 `#F5F2EF` / 墨黑 `#1C1410` / **唯一强调色番红 `#D8000F`**。红色只用在: 一条 kicker rule、巨型 figure、标题中间行、footer 右侧 metadata。其余皆墨黑。全片**只此一个**强调色。

【主结构 (时间轴, 默认 5s)】
- **0.35s** 纸底淡入 (印刷感的"落纸"而非"打光")。
- **0.5s 起** 顶部 kicker: 左 mono 标签淡入 → 番红 rule 从左 scaleX 划过 → 右 mono 日期淡入。
- **0.7s** 右上巨型番红 figure (`Shrikhand` 320px) 带旋转 (-14° → -6°) 从上落入。
- **1.15s 起** 三行标题逐行升起, 每行各自 tilt: 行1 墨黑 -2°、行2 番红 -4°、行3 墨黑 +2°。
- **1.95s** 衬线斜体副题 (`Libre Baskerville` italic) fadeUp。
- **2.15s** footer 墨黑 rule 划入 + mono metadata 淡入。

【内容纪律】
- headline 最多 3 行, 第 2 行自动番红; 必须真实标题, 严禁 lorem ipsum。
- 版式为"少量大字陈述", 不适合塞段落 — 信息密度高的内容请换模板。
- CJK 文本: letter-spacing 归 0、放松行高、不要对 CJK 做 uppercase。
- 动效用 `@keyframes`, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML, 字体走 Google Fonts。
