---
name: frame-creative-voltage
zh_name: "Creative Voltage Split-Screen Frame"
en_name: "Creative Voltage Frame"
emoji: "⚡"
description: "Electric split with hand-drawn script — offset panels slide in, display title rises with an outlined word, script strokes itself in."
zh_description: "Creative Voltage split-screen frame: electric-blue/dark offset panels slide in + outlined electric word + handwritten script strokes itself in, retro-modern and energetic"
en_description: "Electric split with hand-drawn script — offset panels slide in, display title rises with an outlined word, script strokes itself in."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["split-panel", "electric", "script", "retro-modern", "voltage", "frame"]
example_id: sample-frame-creative-voltage
example_name: "Creative Voltage Frame · make it move"
example_format: markdown
example_tagline: "Electric-blue/dark offset split + handwritten script strokes itself in"
example_desc: "Energetic brand title — outlined electric word + handwritten script stroke-in + swept underline"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Creative Voltage (MIT)"
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
  example_prompt: "Use the Creative Voltage Frame template to turn my title into an energetic split reveal — electric-blue and dark panels sliding in offset, a display title rising with one outlined electric word, and a handwritten script stroking itself in. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the 'Creative Voltage Split-Screen Frame' template to turn my title into an energetic split-screen reveal: electric-blue and dark panels sliding in offset + the title rising with one outlined electric word + a handwritten script stroking itself in. Preserve the template's visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

[Template: Creative Voltage Split-Screen Frame (Creative Voltage)]
[Intent] Energetic brand/event title / creative reveal with a handwritten human touch / retro-modern hero. Visual style distilled from the frontend-slides "Creative Voltage" preset (MIT, © Zara Zhang).

[Canvas] 1920×1080, left electric-blue panel (`#2f4bff`, 47%) + right dark panel (`#0d0d14`, 53%), offset split.

[Fonts] display `Syne` 800; mono `Space Mono`; handwritten `Caveat`.

[Main structure (timeline, default 4s)]
- **0.1s** Left blue panel slides in from translateX(-100%); **0.25s** right dark panel slides in from translateX(100%) (staggered, expo-out).
- **0.9s** Electric highlight wash on the blue panel's top-left fades in.
- **1.0s** Mono meta line on the blue panel's top-left (`// CREATIVE_MODE · ON`) fades in.
- **From 1.0s** Display title on the right panel rises line by line (each `.ln`, staggered 180ms); one line uses `.volt` for the outlined electric word (`-webkit-text-stroke` + blue fill). font-size 132px, right-aligned.
- **1.4s** Handwritten script on the blue panel (`Caveat`, rotate -7°) pops in.
- **1.9s** Hand-drawn underline below the script (SVG path, stroke-dashoffset draws itself in).
- **2.2s** Mono caption at bottom-right fades in.

[Color discipline] Electric blue `#2f4bff`/`#6f86ff` / dark `#0d0d14` / white. Blue is the energy primary color; the outlined word and script create the "voltage" contrast. **No** stray colors allowed.

[Content discipline]
- Split the display title into 2-4 lines; pick one word for the `.volt` outlined emphasis.
- The script is a short handwritten phrase (≤24 characters) that gives the frame a human touch.
- Must use a real title; lorem ipsum is strictly forbidden.
- Motion uses `@keyframes` + SVG stroke; under `prefers-reduced-motion`, everything stops at its final state.
- Single-file HTML.
