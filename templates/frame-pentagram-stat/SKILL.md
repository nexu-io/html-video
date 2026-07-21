---
name: frame-pentagram-stat
zh_name: "Swiss Grid Stat Frame"
en_name: "Pentagram Stat Frame"
emoji: "📊"
description: "Swiss-grid statistic anchor — giant number, red accent, growing bars, black data bar. Rational and editorial."
zh_description: "Swiss-grid statistic frame: giant number anchor + red accent + growing bar chart + black data bar, a rational, restrained editorial style"
en_description: "Swiss-grid statistic anchor — giant number, red accent, growing bars, black data bar. Rational and editorial."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 8
tags: ["stat", "swiss-grid", "editorial", "data", "pentagram", "number", "frame"]
example_id: sample-frame-pentagram-stat
example_name: "Swiss Data Frame · 95.7"
example_format: markdown
example_tagline: "Giant red-and-black numerals + Swiss grid + growing bar chart"
example_desc: "Single key-metric anchor + grid lines sweeping in + black data bar sliding in"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Pentagram (MIT)"
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
  example_prompt: "Use the Pentagram Stat Frame template to turn my key metric into a Swiss-grid data reveal — a giant number anchor, red accent, growing bar chart, and a black data bar. Preserve the template's visual signature, use real numbers, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the Swiss Grid Stat Frame template to turn my key metric into a Swiss-style data reveal: giant number anchor + red accent + growing bar chart + black data bar. Preserve the template's visual signature, use real numbers, and avoid lorem ipsum and placeholder images."
---

【Template: Swiss Grid Stat Frame (Pentagram Stat)】
【Intent】Single key-metric / benchmark reveal / editorial data page. Visual style distilled from the huashu-design "Pentagram" school (MIT, © alchaincyf).

【Canvas】1920×1080, pure white background `#ffffff`; overlaid with a Swiss grid — thin horizontal/vertical rules (black, opacity 0.04-0.06), sweeping in via scaleX/scaleY from 0 within the opening 0.7s.

【Fonts】Latin script `Archivo` (900/700/500) or `Helvetica Neue`; for CJK text, `Noto Sans SC` Bold. Rational, tight, negative letter-spacing.

【Main structure (timeline, default 4s)】
- **0.0-0.7s** Grid lines sweep in (scaleX/scaleY 0→1, cubic-bezier(0.16,1,0.3,1)).
- **0.5-1.6s** Giant number anchor on the right (font-size ~1020px, weight 900, black, opacity 0.07) rises in from 8% below while fading in, bleeding off the right edge.
- **0.7s** Red eyebrow label (uppercase, letter-spacing 6px, `#E63946`) fadeUp.
- **0.85s** Main-number headline (~200px, weight 900) fadeUp; the period/unit is accented in `#E63946` red.
- **1.15s** Subtitle (24px, `#999`) fadeUp.
- **1.3s** Red center rule (5px tall) grows from width 0 → 400px.
- **1.35-1.7s** 5 bars grow from the bottom with staggered timing, scaleY 0→1; the middle bar is `#E63946` red + opacity 0.85, the rest are black at opacity 0.12.
- **1.5s** Black data bar (80px tall) slides in from translateY(100%); contains 3 stat groups (large red numbers + small grey-white labels) + a system label on the right.

【Color discipline】Use only black / white / `#E63946` red / neutral grey `#999`. **Strictly forbidden** to use any other colors. Red is the only accent color, used on the label / main-number punctuation / center rule / middle bar / data-bar numbers.

【Content discipline】
- Must use the user's real metric/number; lorem ipsum or fabricated benchmarks are strictly forbidden.
- headline is a number (≤12 characters); anchor is its shortened form (≤4 characters) used as the giant background numeral.
- Animation uses `@keyframes`; under `prefers-reduced-motion`, everything stops at its final state (renders as a static image).
- Single-file HTML.
