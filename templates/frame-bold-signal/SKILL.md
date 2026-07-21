---
name: frame-bold-signal
zh_name: "Bold Signal Frame"
en_name: "Bold Signal Frame"
emoji: "🔶"
description: "Bold colored card on a dark gradient — big section number, nav breadcrumb, orange card sliding in, title rising."
zh_description: "Bold Signal Frame: dark gradient background + big number + nav breadcrumb + orange card sliding in + title rising, high impact"
en_description: "Bold colored card on a dark gradient — big section number, nav breadcrumb, orange card sliding in, title rising."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["bold", "card", "dark", "orange", "section", "signal", "frame"]
example_id: sample-frame-bold-signal
example_name: "Bold Signal Frame · 01/04"
example_format: markdown
example_tagline: "Dark gradient background + orange focal card + big number"
example_desc: "Section divider / bold statement — orange card slides in from the right + title rises"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Bold Signal (MIT)"
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
  example_prompt: "Use the Bold Signal Frame template to turn my section into a bold colored-card divider — a big section number, a nav breadcrumb, and a vibrant orange card sliding in from the right with the title rising. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the 'Bold Signal Frame' template to turn my section into a bold colored-card divider: a big number + a nav breadcrumb + a vibrant orange card sliding in from the right + the title rising. Preserve the template's visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

[Template: Bold Signal Frame (Bold Signal)]
[Intent] Section/paragraph divider / bold launch statement / high-impact title card. Visual style distilled from the frontend-slides "Bold Signal" preset (MIT, © Zara Zhang).

[Canvas] 1920×1080, dark background `#1a1a1a` + 135° gradient (`#1a1a1a → #2d2d2d → #1a1a1a`).

[Fonts] display `Archivo Black` (900); body `Space Grotesk` 400/500/700.

[Main structure (timeline, default 4s)]
- **0.2s** Large section number top-left (`Archivo Black` 96px, e.g. `01/04`, the half after the slash at opacity 0.3) rolls in from above.
- **0.4s onward** Nav breadcrumb top-right fades in with staggered timing: the active item is `#FF5722` orange at opacity 1, the rest are white at opacity 0.35.
- **0.6s** The orange focal card (`#FF5722`, 36px rounded corners on the left side only, occupying the right ~1180px) slides in from translateX(110%), with a soft orange shadow.
- **1.15s** The label inside the card (uppercase, letter-spacing 4px) fades up.
- **1.3s** The large title inside the card (`Archivo Black` 130px, dark `#1a1a1a` on orange) fades up.
- **1.6s** Footer bottom-left (orange tick bar + system label) fades in.

[Color discipline] Dark grayscale background + a single accent color `#FF5722` orange (focal card / active nav / footer tick). Can be swapped for another coral/vibrant accent, but **use only one** accent color across the whole piece. Text on the card should be dark to maintain contrast.

[Content discipline]
- Title 1-2 lines, must use a real title — lorem ipsum is strictly forbidden.
- Nav breadcrumb should reflect the real section structure, with the first item active.
- Motion uses `@keyframes`; under `prefers-reduced-motion` everything stops at its final state.
- Single-file HTML.
