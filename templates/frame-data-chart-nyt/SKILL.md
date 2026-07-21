---
name: frame-data-chart-nyt
zh_name: "NYT-Style Data Chart Frame"
en_name: "NYT-Style Data Chart Frame"
emoji: "📈"
description: "NYT-newsroom typography, staggered reveal animation, and editorial-grade charts (line, bar, or range band)."
zh_description: "NYT-newsroom typography + staggered reveal animation + editorial-grade charts (line / bar / range band)"
en_description: "NYT-newsroom typography, staggered reveal animation, and editorial-grade charts (line, bar, or range band)."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 46
tags: ["data", "chart", "nyt", "editorial", "frame"]
example_id: sample-frame-data-chart-nyt
example_name: "NYT-Style Line Chart · Global User Volume"
example_format: markdown
example_tagline: "Editorial-grade chart + staggered reveal"
example_desc: "8-year weekly active users line chart + NYT red accent + mono annotations"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · data-chart"
od:
  mode: video
  surface: video
  scenario: video
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the NYT-Style Data Chart Frame template to turn my content into a frame with NYT-newsroom typography, staggered reveal animation, and editorial-grade charts. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the NYT-Style Data Chart Frame template to turn my content into a frame with NYT-newsroom typography, staggered reveal animation, and editorial-grade charts (line/bar/range band). Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: NYT-Style Data Chart Frame]
[Intent] Turn a piece of data (CSV / JSON / a one-line conclusion) into a New York Times op-ed-style single frame or animated chart, suitable for a video clip or a tweet card. Inspired by hyperframes data-chart.

[Canvas] 1920×1080, choose one of two backgrounds: warm-white `#f7f5ee` or ink-black `#0e0e0e`; text color is the inverse of the background.

[Layout]
- **Top kicker** (11px uppercase, letter-spacing 0.14em, color = accent red `#a91d1d` or mint `#5fb38a`): data source + category, e.g. "GLOBAL · WEEKLY ACTIVE USERS · 2018–2026".
- **Large headline** (Cheltenham / Playfair / Source Serif Pro, 5.6vw, optional italic subline): a single-sentence conclusion. **The conclusion must be distilled from the user's data**, not a description of the chart.
- **Chart area** (occupies 55–65% of the canvas):
  - Line chart: 1-2 lines; primary line solid ink 2.5px, secondary line dashed 1.5px; data points as 6px solid circles; annotate key points with small black mono text like `2024 · 412M`.
  - Bar chart: all bars solid ink, or add one accent-highlighted bar; large number atop each bar; italic category label beneath each bar (Cheltenham italic).
  - Range band: light-gray fill `#e6e2d2` envelope + ink-colored center line.
- **Bottom source + footnote** (10px mono, opacity 0.6): "Source: [user data] · Chart by html-anything".
- **Staggered reveal animation**: headline fade-in (0s), kicker (200ms), line stroke-dashoffset 1.2s ease-out (400ms), data labels stepping in at 100ms intervals. Can be disabled via `prefers-reduced-motion`.

[Design details]
- **Never**: use the chart.js / d3 library (unless imported via jsdelivr CDN); hand-written SVG is recommended, no more than 80 lines inline.
- Fonts: headline `Source Serif Pro` or `Cheltenham` (fall back to `Playfair Display` if unavailable); body `IBM Plex Sans` or `Inter`; data labels `IBM Plex Mono`.
- 1 primary color (ink) + 1 accent, choose one of: NYT red `#a91d1d` / editorial mint `#5fb38a` / warm orange `#d97757`.
- Y-axis: hairline ticks only, 3-4 ticks, labels outside the axis in mono type.
- Strictly forbidden: full-screen grid lines, drop shadows, 3D-extruded bars; emoji are strictly forbidden.
- Must use the data the user provides. If the input is a text conclusion, auto-estimate reasonable coordinates (but label it "schematic"); if it's CSV/JSON, plot it directly.
- Single-file HTML; annotation format next to data points: `<text class="annot">2024 · 412M</text>`.
