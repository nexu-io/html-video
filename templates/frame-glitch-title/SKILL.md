---
name: frame-glitch-title
zh_name: "Glitch Title Frame"
en_name: "Glitch Title Frame"
emoji: "⚡"
description: "Digital glitch, chromatic offset, and data-corruption title frame for video transitions or cyberpunk heroes."
zh_description: "Digital glitch, chromatic offset, and data-corruption title frame for video transitions or cyberpunk heroes."
en_description: "Digital glitch, chromatic offset, and data-corruption title frame for video transitions or cyberpunk heroes."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 37
recommended: 6
tags: ["glitch", "cyberpunk", "title", "transition", "vfx", "frame"]
example_id: sample-frame-glitch-title
example_name: "Glitch Title · SIGNAL_LOST"
example_format: markdown
example_tagline: "Cyan/magenta chromatic aberration + CRT scanlines"
example_desc: "Giant title + data-corruption artifacts + corner ASCII noise chunks"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · glitch"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0.14
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Glitch Title Frame template to turn my content into a digital-glitch, chromatic-offset, data-corruption title frame for a video transition or cyberpunk hero. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the \"Glitch Title Frame\" template to turn my content into a digital-glitch, chromatic-offset, data-corruption title frame for a video transition or cyberpunk hero. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: Glitch Title Frame (Glitch Title)]
[Intent] Single-frame hero / video transition / cyberpunk-style title. Inspired by hyperframes glitch.

[Canvas] 1920×1080, background `#070708` near-black or CRT dark gray `#0d0e10`; add a 56px grid (5% opacity) + horizontal scanlines (8% opacity, 2px spacing).

[Main title]
- Centered, 6-9vw, weight 800/900, font `Space Grotesk Bold` / `Inter Tight Black` / `JetBrains Mono Bold`.
- Color: main layer `#f5f5f7`; stack 2 artifact layers behind it:
  - cyan `#00f0ff` translate(`-3px`, `1px`).
  - magenta `#ff2bd6` translate(`3px`, `-1px`).
- Slice the whole layer into 5-8 clip-path segments; each segment gets a `@keyframes` animation with random translateX -10px → 10px, lasting 80-160ms, staggered playback, to create a "data corruption" chromatic-aberration effect.
- Trigger a "heavy glitch" every 1.5s — the entire title gets a 1-frame horizontal smear, using `filter: url(#displacementFilter)` or a simple CSS translate.

[Additional layers]
- Top caption line (uppercase mono, 11px, opacity 0.6): `>> SIGNAL_LOST · CH-04 · 14:32:08`.
- One subtitle line under the title (24-28px, mono, opacity 0.7), occasionally with characters replaced by ` ̶▒̶` (fake corrupted glyphs).
- Random `█▓▒░` ASCII noise chunks scattered in the corners.
- Bottom timecode (mono, opacity 0.4).
- A noise grain layer over the whole frame `background-image: url("data:image/svg+xml,...turbulence...")`, opacity 6%, mix-blend-mode overlay.

[SVG filter (optional)]
- Define `<filter id="rgbShift">` using `feColorMatrix` + `feOffset` + `feMerge` to shift the R/G/B channels; apply `filter: url(#rgbShift)` to the whole layer during glitch moments.

[Design details]
- Colors limited to: black / white / cyan / magenta / a touch of amber warning color; full rainbow strictly forbidden.
- Fonts: Latin `Space Grotesk` or `JetBrains Mono` Bold; CJK `Noto Sans Mono CJK SC` or `Noto Sans SC` Bold.
- Lorem ipsum strictly forbidden; must use the user's actual title + subtitle.
- Motion uses `@keyframes`, can be disabled via `prefers-reduced-motion` (fall back to a static chromatic split).
- Single-file HTML.
