---
name: frame-electric-studio
zh_name: "Electric Studio Split-Panel Frame"
en_name: "Electric Studio Frame"
emoji: "🔷"
description: "Two-panel split with quote as hero — white/blue panels open from center, accent bar grows, quote reveals line by line."
zh_description: "Electric Studio split-panel frame: white/blue panels open from the center + accent bar grows + quote reveals line by line, high-contrast and professional"
en_description: "Two-panel split with quote as hero — white/blue panels open from center, accent bar grows, quote reveals line by line."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["split-panel", "quote", "blue", "high-contrast", "studio", "frame"]
example_id: sample-frame-electric-studio
example_name: "Electric Studio Split Frame · Quote"
example_format: markdown
example_tagline: "White/blue panels open + quote reveals line by line"
example_desc: "pull-quote / mission statement — black accent bar + quote spanning both panels"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Electric Studio (MIT)"
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
  example_prompt: "Use the Electric Studio Frame template to turn my quote into a two-panel split reveal — white top and electric-blue bottom panels opening from center, a black accent bar growing on the seam, and the quote revealing line by line. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the Electric Studio Split-Panel Frame template to turn my quote into a two-panel split reveal: white top panel + electric-blue bottom panel opening from the center + a black accent bar growing at the seam + the quote revealing line by line. Preserve the template's visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

[Template: Electric Studio Split-Panel Frame (Electric Studio)]
[Intent] pull-quote / testimonial / mission statement / high-contrast title. Visual style distilled from the frontend-slides "Electric Studio" preset (MIT, © Zara Zhang).

[Canvas] 1920×1080, white top panel (540px) + electric-blue bottom panel (`#4361ee`, 540px), split at the center line.

[Typography] Both display and body use `Manrope` 800/700/500/400.

[Main structure (timeline, default 4s)]
- **0.1s** Top panel falls from translateY(-100%), bottom panel rises from translateY(100%), both landing in place as they "open" from the center (expo-out).
- **0.9s** The black accent bar at the seam (8px tall) grows from width 0 → 320px.
- **From 1.0s** The quote reveals line by line (each line `.ln`, staggered 150ms, translateY 26→0); lines that cross into the blue panel are white (`.on-blue`). font-size 96px, weight 800.
- **2.2s** The bottom-panel attribution (name 28px 700 + role uppercase at 0.7 opacity, white) fades in.
- **2.5s** The top-right brand mark (dark) + bottom-right brand mark (white at 0.6) fade in.

[Color discipline] Three colors: white / electric blue `#4361ee` / near-black `#0a0a0a`. The accent bar and brand marks use black/white; blue is the large color block. **No** fourth primary color.

[Content discipline]
- Split the quote into 2-4 lines, with 1-2 lines landing on the blue panel (toggle the `.on-blue` class) to create cross-panel contrast.
- Must use a real quote/statement — lorem ipsum is strictly forbidden.
- Motion uses `@keyframes`; under `prefers-reduced-motion` everything stops at its final state.
- Single-file HTML.
