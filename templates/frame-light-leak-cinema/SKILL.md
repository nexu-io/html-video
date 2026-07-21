---
name: frame-light-leak-cinema
zh_name: "Light-Leak Cinematic Frame"
en_name: "Light-Leak Cinematic Frame"
emoji: "🎞️"
description: "Film light leaks, grain, 16:9 letterbox, and large serif type for cinematic openings or chapter cards."
zh_description: "Film light leaks + grain noise + 16:9 letterbox + large serif type, cinematic opening / chapter card"
en_description: "Film light leaks, grain, 16:9 letterbox, and large serif type for cinematic openings or chapter cards."
category: video
scenario: video
aspect_hint: "2.39:1 letterbox (1920×800) or 16:9 (1920×1080)"
featured: 36
tags: ["cinema", "film", "light-leak", "grain", "letterbox", "frame"]
example_id: sample-frame-light-leak-cinema
example_name: "Light Leak · REEL 03"
example_format: markdown
example_tagline: "Warm amber light leak + 35mm grain"
example_desc: "2.39:1 letterbox + italic serif display type + film sprocket holes"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · light-leak"
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
  example_prompt: "Use the Light-Leak Cinematic Frame template to turn my content into a cinematic opening or chapter card with film light leaks, grain, letterbox framing, and large serif type. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the Light-Leak Cinematic Frame template to turn my content into a \"film light leaks + grain noise + 16:9 letterbox + large serif type, cinematic opening / chapter card\". Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: Light-Leak Cinematic Frame]
[Intent] An opening single frame for documentaries / personal short films / video chapter cards — warm amber light leaks + 35mm grain + large serif type, classic film texture. Inspired by hyperframes light-leak.

[Canvas]
- **2.39:1 letterbox** (recommended): 1920×800, top and bottom black bars 140px each (`#000`).
- Or 16:9: 1920×1080, no letterbox.

[Background]
- Base layer: a dark warm tone (deep red-brown `#1a0d08` / dark green `#0a1410` / blue-violet `#0d0e1a`) or a depicted scene (CSS gradient simulating sky / interior / exterior).
- **Light Leak**: 2-3 large `radial-gradient(ellipse at top right, #ffb547 0%, transparent 50%)` + 1 bottom `linear-gradient(to top, #d97757 0%, transparent 30%)`; use warm orange / peach / rose / dark yellow, **never cool blue**.
- **35mm Grain**: a full-screen SVG turbulence noise layer, opacity 14%, `mix-blend-mode: overlay`; can also use `background-image: url("data:image/svg+xml,...feTurbulence...")`.
- Optional: one `feDisplacementMap` pass to simulate film wobble (use sparingly).

[Text]
- Center or bottom-left: large serif display type (Source Serif Pro / Playfair Display / EB Garamond) 5-8vw, weight 500 italic; color warm white `#f5e9d6` or cream.
- Subtitle (24-28px), one line, opacity 0.7, same serif.
- Corner caption (uppercase, letter-spacing 0.18em, 10-11px, mono, opacity 0.5): "REEL 03 · CH I · 1985".
- Bottom timecode + shooting location + date (mono, opacity 0.4).

[Optional extras]
- "Film scratches": a few 1-2px vertical white lines, opacity 0.2, irregular spacing (use multiple `box-shadow` insets or multiple `<div>` elements).
- "Sprocket holes": evenly-spaced small white squares inside the letterbox black bars (CSS repeating-linear-gradient).
- Entrance animation: the whole frame goes from underexposed (brightness 0.3) → normal within 800ms; the light-leak position drifts slowly on a 12s cycle.

[Design details]
- Never use more than 4 hues total (dark background + 2 warm light-leak colors + cream text).
- Strictly forbidden: blue-violet light leaks (breaks the film texture), emoji, neon colors, geometric dashboard decoration.
- Chinese text: `Noto Serif SC` italic does not exist → use `Noto Serif SC` regular with increased letter-spacing instead.
- Must use the title provided by the user; auto-estimate reasonable "year / chapter / location" metadata (but derive it from the user's content).
- Single-file HTML; use `prefers-reduced-motion` to disable animation.
