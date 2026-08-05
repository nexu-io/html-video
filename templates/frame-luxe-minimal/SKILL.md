---
name: frame-luxe-minimal
zh_name: "奢华极简留白帧"
en_name: "Luxe Minimal Frame"
emoji: "◇"
description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
zh_description: "奢华极简留白帧:单词逐字浮现 + 暖金细线 + 呼吸感细线指示器, 70%+ 留白"
en_description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 7
tags: ["minimal", "luxury", "whitespace", "hero", "gold", "luxe", "frame"]
example_id: sample-frame-luxe-minimal
example_name: "奢华极简帧 · Local"
example_format: markdown
example_tagline: "超细 Inter 单词逐字浮现 + 暖金细线"
example_desc: "70% 留白 + 角标 + 侧边竖排标签 + 8 条呼吸细线"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · luxury minimal (MIT)"
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
  example_prompt: "Use the Luxe Minimal Frame template to turn my brand word into a luxury-minimal whitespace hero — a single word revealing letter by letter in ultra-thin type, a warm-gold hairline, and breathing indicators. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「奢华极简留白帧」模板把我的品牌词做成一段奢华极简留白 hero:超细字重单词逐字浮现 + 暖金细线 + 呼吸感指示器。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 奢华极简留白帧 (Luxe Minimal)】
【意图】高端品牌 hero / 单词陈述 / 优雅标题卡。视觉提炼自 huashu-design 的奢华极简 showcase (MIT, © alchaincyf)；L1 灵感见 provenance.origin，勿用工作室名当模板名。

【画布】1920×1080, 暖白底 `#FAFAF8`; 左上叠暖金径向 wash (`rgba(212,165,116,0.07)`)。**70%+ 留白是这套风格的灵魂**, 不要填满。

【字体】西文 `Inter` weight 200/300 (超细); 中文 `Noto Sans SC` Light。字距收紧 (-4 ~ -7px)。

【主结构 (时间轴, 默认 5s)】
- Hero 单词拆成 `.ch` span, 错峰 letter-by-letter fadeUp。
- 暖金 `#D4A574` hairline 从中心向两侧伸展。
- 底部薄指示条错峰升起并呼吸。
- `prefers-reduced-motion` 下停在终态。

【内容纪律】hero ≤16 字符单字/短词; 真实品牌文案; 单文件 HTML。
