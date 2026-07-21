---
name: frame-build-minimal
zh_name: "Luxury Minimal Whitespace Frame"
en_name: "Build Minimal Frame"
emoji: "◇"
description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
zh_description: "Luxury minimal whitespace frame: word reveals letter by letter + warm-gold hairline + breathing thin-line indicators, 70%+ whitespace"
en_description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 7
tags: ["minimal", "luxury", "whitespace", "hero", "gold", "build", "frame"]
example_id: sample-frame-build-minimal
example_name: "Luxury Minimal Frame · Agent"
example_format: markdown
example_tagline: "Ultra-thin Inter word reveal letter by letter + warm-gold hairline"
example_desc: "70% whitespace + corner marks + vertical side labels + 8 breathing thin lines"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Build (MIT)"
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
  example_prompt: "Use the Build Minimal Frame template to turn my brand word into a luxury-minimal whitespace hero — a single word revealing letter by letter in ultra-thin type, a warm-gold hairline, and breathing indicators. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the 'Luxury Minimal Whitespace Frame' template to turn my brand word into a luxury-minimal whitespace hero: an ultra-thin-weight word reveal letter by letter + a warm-gold hairline + breathing indicators. Preserve the template's visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

[Template: Luxury Minimal Whitespace Frame (Build Minimal)]
[Intent] Premium brand hero / single-word statement / elegant title card. Visual style distilled from the "Build Studio" school within huashu-design (MIT, © alchaincyf).

[Canvas] 1920×1080, warm-white background `#FAFAF8`; warm-gold radial wash overlaid top-left (`rgba(212,165,116,0.07)`). **70%+ whitespace is the soul of this style** — do not fill the frame.

[Typography] Latin `Inter` weight 200/300 (ultra-thin); CJK `Noto Sans SC` Light. Tight letter-spacing (-4 ~ -7px).

[Main structure (timeline, default 5s)]
- **0.2s** Four corner marks (warm-gold 0.5px stroke, L-shaped) + warm-gold wash fade in.
- **0.5s** eyebrow (uppercase, letter-spacing 9px, `#B0ACA4`) fadeUp.
- **from 0.6s** hero word reveals character by character (each character a `.ch` span, staggered 80ms, translateY 30→0, expo-out). font-size ~220px, weight 200.
- **1.9s** warm-gold hairline (`#D4A574`, 1px tall) grows from width 0 → 88px, centered.
- **2.2s** two lines of desc (weight 300, `#A8A4A0`, line-height 2) fadeUp.
- **1.8s** vertical side labels (one on each side, rotate ±90°) fade in.
- **from 2.4s** 7 thin vertical lines at the bottom (1.5px, some warm-gold) rise in a staggered sequence, then enter a 4s slow breathing loop (opacity 1↔0.45).

[Color discipline] Use only warm-white `#FAFAF8` / near-black `#1A1A18` / warm-gold `#D4A574` / warm-gray `#A8A4A0`/`#B0ACA4`. **No** saturated/bright colors. Warm-gold is the only accent, used with extreme restraint (hairline / corner marks / a few indicators).

[Content discipline]
- hero is a single word (≤16 characters); must use the user's real brand word/topic word.
- desc is two short lines; lorem ipsum is strictly forbidden.
- Motion uses `@keyframes`; under `prefers-reduced-motion`, everything stops at its final state.
- Single-file HTML.
