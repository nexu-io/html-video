---
name: frame-takram-organic
zh_name: "Eastern Soft Organic Frame"
en_name: "Takram Organic Frame"
emoji: "🌿"
description: "Soft-tech radial node graph as art — frosted rounded card, curved links drawing in, nodes popping outward, gentle float."
zh_description: "Eastern soft organic frame: frosted rounded card + curved links drawing in + radial nodes popping outward + gentle float, beige natural tones"
en_description: "Soft-tech radial node graph as art — frosted rounded card, curved links drawing in, nodes popping outward, gentle float."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 7
tags: ["organic", "soft-tech", "radial", "diagram", "takram", "beige", "frame"]
example_id: sample-frame-takram-organic
example_name: "Soft Organic Frame · Node Graph"
example_format: markdown
example_tagline: "Frosted rounded card + radial nodes popping outward + gentle float"
example_desc: "Beige background + natural tones (sage/terracotta) + eight-node radial graph as art"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Takram (MIT)"
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
  example_prompt: "Use the Takram Organic Frame template to turn my concept into a soft-tech radial node graph — a frosted rounded card with curved links drawing in and nodes popping outward around an evolving core. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "Use the \"Eastern Soft Organic Frame\" template to turn my concept into a soft-tech radial node graph — a frosted rounded card with curved links drawing in and nodes popping outward around an evolving core. Preserve the template's visual signature, use real content, and avoid lorem ipsum and placeholder images."
---

[Template: Eastern Soft Organic Frame (Takram Organic)]
[Intent] System/architecture concept reveal / warm product storytelling / network or memory-graph explainer. Visual language distilled from the "Takram" genre in huashu-design (MIT, © alchaincyf).

[Canvas] 1920×1080, beige background `#EFEAE0`; a sage-green radial wash (`rgba(122,158,127,0.10)`) overlaid on the right. Overall feel: soft, natural, with room to breathe.

[Typography] Latin `Manrope` 700/600/400; CJK `Noto Sans SC`. Rounded, not too hard-edged.

[Main structure (timeline, default 5s)]
- **0.2s** Left frosted rounded card (`rgba(255,253,248,0.66)` + blur 8px + border-radius 40px + soft shadow) rises in from 26px below + scale 0.985.
- **0.7s** Green eyebrow (`#7A9E7F`, uppercase, letter-spacing 4px) fades up.
- **0.9s** Card headline (92px, weight 700) fades up; one accent word in terracotta `#C98A5E`.
- **1.2s** Caption (22px, `#8A867C`, line-height 1.8) fades up.
- **1.3s** Center node of the right-side radial graph (terracotta, r=40) pops in (overshoot).
- **From 1.4s** 8 curved links (sage `#B8C9BA`, stroke-dasharray draw) trace out from the center in a staggered sequence.
- **From 1.9s** 8 outer nodes (sage green, r=22) pop in a staggered sequence (scale 0→1, overshoot).
- **From 2.0s** The whole radial graph enters a 7s slow floating loop (subtle translateY motion).

[Color discipline] Beige `#EFEAE0` / warm white card / sage green `#7A9E7F`·`#B8C9BA` / terracotta `#C98A5E` / warm gray text. **Forbidden**: high-saturation tech blue/purple. Green is the structural color, terracotta is the accent color (center node + headline accent word).

[Content discipline]
- The node graph is "art" — node count 4-8, adjusted per content (edit the node/link count and angles in the SVG).
- Must use real concepts/relationships; lorem ipsum is strictly forbidden.
- Motion uses `@keyframes` + SVG stroke-dashoffset; everything settles into its final state under `prefers-reduced-motion`.
- Single-file HTML.
