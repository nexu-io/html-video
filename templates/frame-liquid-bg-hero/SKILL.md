---
name: frame-liquid-bg-hero
zh_name: "Liquid Background Hero Frame"
en_name: "Liquid Background Hero"
emoji: "🌊"
description: "WebGL-style fluid displacement background with a quote overlay, suited to video intros, landing heroes, or posters."
zh_description: "WebGL-style fluid displacement background with a quote overlay on top, suited to video intros / landing heroes / posters"
en_description: "WebGL-style fluid displacement background with a quote overlay, suited to video intros, landing heroes, or posters."
category: poster
scenario: video
aspect_hint: "1920×1080 (16:9) or 1080×1920 (9:16)"
featured: 39
tags: ["liquid", "fluid", "background", "hero", "html-in-canvas", "vfx"]
example_id: sample-frame-liquid-bg-hero
example_name: "Liquid Background Hero · Quote"
example_format: markdown
example_tagline: "Aurora Violet Liquid"
example_desc: "Multi-layer radial-gradient breathing background + difference-blend text"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · vfx-liquid-background"
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
  example_prompt: "Use the Liquid Background Hero template to turn my content into a WebGL-style fluid displacement background with a quote overlay for a video intro, landing hero, or poster. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the Liquid Background Hero template to turn my content into a WebGL-style fluid displacement background with a quote overlay, suited to a video intro, landing hero, or poster. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: Liquid Background Hero]
[Intent] Works as a video intro frame, a SaaS landing page top hero, or a poster background. WebGL-fluid look, but rendered with a CSS/canvas fallback so it stays a single HTML file that opens by double-click. Inspired by hyperframes vfx-liquid-background.

[Canvas] 1920×1080 (landscape) or 1080×1920 (portrait) — pick one. Background fills the full frame.

[Liquid background — 3 implementation options, pick per user preference]
1. **CSS multi-layer radial-gradient offset breathing** (most stable, default recommendation):
   - 3-5 large ellipse `radial-gradient(...)` shapes, colors drawn from the palette.
   - Each ellipse gets a `@keyframes` animation combining translate + scale + hue-rotate, 8-14s period, staggered/offset timing; the whole composition layers `mix-blend-mode: screen` or `overlay` on top.
   - Add one top layer of `backdrop-filter: blur(80px)` to soften the edges further.
2. **Canvas + simple perlin noise** (intermediate):
   - ~80 lines of inline JS, using `requestAnimationFrame` to draw metaballs or a simplex noise field.
   - Enable when performance allows; fall back to a static snapshot when `prefers-reduced-motion` is set.
3. **WebGL fragment shader** (advanced, use with caution):
   - Pull in `regl` via the jsdelivr CDN, or write plain inline WebGL.
   - Write the shader as domain-warp noise; a single quad, one `u_time` uniform.

[Top text layer]
- Centered or bottom-left: one giant headline quote (5-7vw, serif or bold sans), font: `Source Serif Pro` / `Inter Tight` / `Manrope Black`.
- Text color: paper white `#fafaf8` or ink, depending on background lightness/darkness; add `mix-blend-mode: difference` so it stays readable over any liquid color.
- Subhead: one line (small sans, opacity 0.7).
- Optional at the bottom: a CTA chip, or a hairline + metadata row.

[Palette — pick 1 of 4, no rainbow]
- 🌅 **Solar Peach** — `#ffb18a` + `#f78b4c` + `#d97757`, warm orange-peach.
- 🌊 **Ocean Aqua** — `#5ac8fa` + `#0a84ff` + `#1e3a8a`, ocean blue.
- 🌌 **Aurora Violet** — `#a78bfa` + `#7c5cff` + `#1e1b4b`, aurora violet.
- 🌿 **Forest Mint** — `#86efac` + `#34d399` + `#065f46`, mossy forest.

[Design details]
- Forbidden: multi-color rainbow (>4 hues), PowerPoint-style gradients, neon glow overlays.
- Fonts: for Chinese-script text, use `Noto Serif SC` (display) / `Noto Sans SC` (subhead).
- No external image links; everything must be CSS + SVG + optional canvas.
- Must use the quote/headline the user provided; if the user's input is data → distill it into a single quote of ≤ 18 characters.
- Single-file HTML; motion can be disabled via `prefers-reduced-motion`.
