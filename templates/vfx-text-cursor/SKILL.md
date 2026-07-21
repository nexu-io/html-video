---
name: vfx-text-cursor
zh_name: "VFX Text Cursor"
en_name: "VFX Text Cursor"
emoji: "✨"
description: "Cursor light trail, chromatic rays, and directional flares for word-by-word quote reveals in video intros."
zh_description: "Cursor light trail, chromatic rays, and directional flares for word-by-word quote reveals in video intros."
en_description: "Cursor light trail, chromatic rays, and directional flares for word-by-word quote reveals in video intros."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 38
recommended: 7
tags: ["vfx", "text", "cursor", "chromatic", "reveal", "frame"]
example_id: sample-vfx-text-cursor
example_name: "VFX Cursor · Opening Quote"
example_format: markdown
example_tagline: "Word-by-word reveal with chromatic light trail"
example_desc: "Cursor typing with hot pink + cyan chromatic aberration, for video openers"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · vfx-text-cursor"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0.15
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the VFX Text Cursor template to turn my content into a video-intro quote reveal with cursor light trails, chromatic rays, and directional flares. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the VFX Text Cursor template to turn my content into a video-intro quote reveal with cursor light trails, chromatic rays, and directional flares. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: VFX Text Cursor]
[Intent] Video opening / hero frame — a cursor "types" across the canvas, text reveals character by character, trailing a chromatic aberration streak + directional light flares. Inspired by hyperframes vfx-text-cursor.

[Canvas] 1920×1080, background `#06070a` matte black or `#0a0d12` (warm-leaning blue); add a subtle vignette.

[Content]
- One quotable line (any language), centered, font size 6-8vw, weight 700, font `Inter Tight` / `Source Sans 3` / `Noto Sans SC`.
- Reveal character by character, 80ms interval per character; the current character is followed by a cursor `▍` (or a thin vertical bar).
- Already-revealed text defaults to white `#f5f5f7`, opacity 1; the position about to be revealed gets a chromatic ghost: a `text-shadow: 2px 0 #ff3b6f, -2px 0 #00d4ff` applied at the moment of reveal, converging back to normal within 200ms.
- The cursor itself: a 16px-wide rectangle, color = accent (pick 1: hot pink `#ff3b6f` / cyan `#00d4ff` / amber `#ffb547`), blinking via `@keyframes` on a 1.0s cycle; trailing a 60-120px motion blur trail behind it (radial gradient fading to transparent).

[Flares / Rays]
- Randomly generate 3-5 **directional light leaks** near the typing position: thin elongated rectangles using `linear-gradient(45deg, transparent, accent20, transparent)` + `mix-blend-mode: screen`, at irregular angles.
- When the text finishes typing, apply a 0.5s shimmer sweep (a band of light sweeping across) over the whole line.

[Fields]
- Top caption (uppercase, letter-spacing 0.18em, 11px, opacity 0.5): "FRAME 01 · OPENING".
- Subtitle beneath the text (24-28px, opacity 0.6): source / chapter.
- Bottom-right timecode (`00:03:21`, monospace).

[Design Details]
- **Never**: multicolor rainbow chromatic aberration (use only a single two-tone pair like hot pink + cyan, not full R/G/B separation).
- Fonts: Latin text `Inter Tight` Bold; Chinese text `Noto Sans SC` Bold; serif fonts strictly forbidden.
- Drive motion with `@keyframes` + a JS timer (`setTimeout` per character), which can be disabled via `prefers-reduced-motion` (show all text immediately).
- Must use the quote the user provides; do not fabricate one.
- Single-file HTML; no external resources besides fonts.
