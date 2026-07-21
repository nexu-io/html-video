---
name: frame-bold-poster
zh_name: "Bold Poster Frame"
en_name: "Bold Poster Frame"
emoji: "🟥"
description: "A 1970s European editorial poster in motion — a red rule draws across, a giant tilted figure drops in, a three-line headline rises line-by-line, an italic serif standfirst fades."
zh_description: "Bold Poster Frame: 1970s European editorial poster style + tomato-red accent color + giant tilted Shrikhand display type + three-line headline rising line-by-line + italic serif standfirst, strong print texture."
en_description: "A 1970s European editorial poster in motion — a red rule draws across, a giant tilted figure drops in, a three-line headline rises line-by-line, an italic serif standfirst fades."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["poster", "editorial", "bold", "serif", "red", "print", "manifesto", "frame"]
example_id: sample-frame-bold-poster
example_name: "Bold Poster Frame · Manifesto"
example_format: markdown
example_tagline: "Tomato red + ink black + giant tilted display type"
example_desc: "Brand manifesto / editorial opener — red line draws in + display type rotates and drops in + three-line headline rises line-by-line"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Bold Poster (MIT)"
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
  example_prompt: "Use the Bold Poster Frame template to open my deck like a magazine cover — a mono kicker with a red rule drawing across, a giant tilted display figure, a three-line headline rising line-by-line (the middle line in red), and an italic serif standfirst. Preserve the template's print-poster signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the Bold Poster Frame template to give my opener a magazine-cover feel: a mono kicker + a red line drawing across + a giant tilted display figure + a three-line headline rising line-by-line (middle line in red) + an italic serif standfirst. Keep the print-poster visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

**Template: Bold Poster Frame (Bold Poster)**
**Intent:** Brand manifesto / vision statement / editorial or cultural opener — make a few words land like a magazine cover. Visuals distilled from frontend-slides' Bold Poster template (MIT, © Zara Zhang), whose upstream inspiration is 1970s European editorial posters / Italian sports magazines / mid-century brand annual reports.

**Canvas:** 1920×1080, warm off-white paper background `#F5F2EF`.

**Fonts:** display + figures `Shrikhand` (poster-grade slanted display type); body `Libre Baskerville` (serif, italic standfirst); mono labels / chrome `Space Grotesk`.

**Color discipline:** paper white `#F5F2EF` / ink black `#1C1410` / **the single accent color, tomato red `#D8000F`**. Red is used only for: one kicker rule, the giant figure, the middle headline line, and the footer's right-side metadata. Everything else is ink black. **Only this one** accent color across the entire frame.

**Main structure (timeline, default 5s):**
- **0.35s** Paper background fades in (a printed "paper settling" feel, not a lighting cue).
- **From 0.5s** Top kicker: left mono label fades in → tomato-red rule draws across from the left via scaleX → right mono date fades in.
- **0.7s** Giant tomato-red figure top-right (`Shrikhand` 320px) drops in with rotation (-14° → -6°).
- **From 1.15s** Three headline lines rise one by one, each with its own tilt: line 1 ink black -2°, line 2 tomato red -4°, line 3 ink black +2°.
- **1.95s** Italic serif standfirst (`Libre Baskerville` italic) fades up.
- **2.15s** Footer ink-black rule draws in + mono metadata fades in.

**Content discipline:**
- Headline is at most 3 lines, line 2 automatically renders in tomato red; must be a real headline, lorem ipsum is strictly forbidden.
- The layout is "a small amount of large-type statement" — not suited to dense paragraphs; use a different template for information-dense content.
- CJK text: reset letter-spacing to 0, loosen line-height, do not uppercase CJK text.
- Animation uses `@keyframes`; under `prefers-reduced-motion` everything stops at its end state.
- Single-file HTML, fonts via Google Fonts.
