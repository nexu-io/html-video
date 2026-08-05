# Attributions

html-video is licensed under Apache-2.0. Some of its bundled video **templates** are
derived from open-source design skills or upstream example libraries under permissive
licenses. This file records every upstream we built on, its real copyright holder, and
its license, as required by the upstream licenses and by
[RFC-07](research/2026-06-04-spec-07-ppt-to-template.md) (our PPT-skill → template
conversion standard).

> **What "derived" means here**: we transformed static presentation/slide designs or
> upstream HTML examples into animated [hyperframes](https://github.com/heygen-com/hyperframes)
> (or native Remotion) video templates — rebuilt as original CSS/SVG keyframe timelines or
> React compositions, re-coloured/re-typed where noted, with our own sample data. No
> upstream source code is copied verbatim unless noted in a template's `transformation`
> field.

Many design styles are homages to real-world studios. Where a template is inspired by a
specific studio, we record that as the **L1 origin** in the template's `provenance`
block — as a factual statement of inspiration, never as a claim of affiliation or
endorsement. Studio names are **not** used as template names.

Per-template details (the full three-layer `provenance` block: `origin` / `via_skill` /
`transformation`) live in each template's `template.html-video.yaml`. Run
`pnpm validate-templates` to audit all 27 templates.

---

## Upstream design skills

### huashu-design

- **Copyright holder**: alchaincyf (花叔 · 花生) © 2026
- **License**: MIT
- **Source**: https://github.com/alchaincyf/huashu-design
- **Used by templates**:
  - `frame-editorial-anchor` — via `assets/showcases/ppt/ppt-pentagram.html`
    (L1 inspiration: Pentagram / Michael Bierut; id is design-feature neutral)
  - `frame-luxe-minimal` — via `assets/showcases/ppt/ppt-build.html`
    (L1 inspiration: Build, London design studio)
  - `frame-soft-radar` — via `assets/showcases/ppt/ppt-takram.html`
    (L1 inspiration: Takram, Japanese design firm)

### frontend-slides

- **Copyright holder**: Zara Zhang © 2025
- **License**: MIT
- **Source**: https://github.com/zarazhangrui/frontend-slides
- **Used by templates**:
  - `frame-bold-signal` — via `STYLE_PRESETS.md` (preset "Bold Signal")
  - `frame-creative-voltage` — via `STYLE_PRESETS.md` (preset "Creative Voltage")
  - `frame-electric-studio` — via `STYLE_PRESETS.md` (preset "Electric Studio")
  - `frame-bold-poster` — via `bold-template-pack/templates/bold-poster/design.md`
    (L1 inspiration: 1970s European editorial poster tradition)

  (The three STYLE_PRESETS templates are original presets composed by the skill author —
  no specific real-world studio is the L1 origin.)

### open-design (nexu-io)

- **Copyright holder**: nexu-io © 2026
- **License**: Apache-2.0
- **Source**: https://github.com/nexu-io/open-design
- **Used by templates** (skill example HTML cherry-picked into html-video packaging):
  - `frame-data-chart-nyt` — `repo/skills/frame-data-chart-nyt/example.html`
  - `frame-glitch-title` — `repo/skills/frame-glitch-title/example.html`
  - `frame-light-leak-cinema` — `repo/skills/frame-light-leak-cinema/example.html`
  - `frame-liquid-bg-hero` — `repo/skills/frame-liquid-bg-hero/example.html`
  - `frame-logo-outro` — `repo/skills/frame-logo-outro/example.html`
  - `vfx-text-cursor` — `repo/skills/vfx-text-cursor/example.html`

---

## Upstream engine example libraries

### Hyperframes (heygen-com)

- **Copyright holder**: HeyGen / Hyperframes contributors
- **License**: Apache-2.0
- **Source**: https://github.com/heygen-com/hyperframes
- **Used by templates** (registry examples packaged for html-video):
  - `frame-decision-tree` — `registry/examples/decision-tree`
  - `frame-kinetic-type` — `registry/examples/kinetic-type`
  - `frame-nyt-graph` — `registry/examples/nyt-graph`
  - `frame-play-mode` — `registry/examples/play-mode`
  - `frame-product-promo` — `registry/examples/product-promo`
  - `frame-swiss-grid` — `registry/examples/swiss-grid`
  - `frame-vignelli` — `registry/examples/vignelli`
  - `frame-warm-grain` — `registry/examples/warm-grain`

### hyperframes-student-kit (Nate Herk)

- **Copyright holder**: Nate Herk
- **License**: MIT
- **Source**: https://github.com/nateherkai/hyperframes-student-kit
- **Used by templates**:
  - `frame-product-promo-30s` — `video-projects/linear-promo-30s`
    (brand-specific Linear assets replaced with generic placeholders)

---

## Original html-video templates (no L2 upstream)

These were authored directly for html-video (native Remotion compositions or original
hyperframes HTML). See each template's `provenance.origin` / `via_skill` for detail.

- `frame-data-rollup` — native Remotion bar chart + count-up
- `frame-data-donut` — native Remotion donut chart
- `frame-data-line` — native Remotion line chart
- `frame-data-hbars` — native Remotion horizontal bar chart
- `frame-data-radar` — native Remotion radar / spider chart
- `frame-kpi-pulse` — native Remotion single-KPI spring + count-up

---

## Studio names referenced as L1 inspiration

The following real-world design studios / designers are named in template `provenance.origin`
purely as a record of stylistic inspiration. html-video is **not affiliated with, endorsed by,
or sponsored by** any of them.

- **Pentagram** (and Michael Bierut) — pentagram.com
- **Build** — London design studio
- **Takram** — takram.com

---

## Agent skill entry point

Coding agents should read [`SKILL.md`](SKILL.md) at the repo root for the CLI contract
(single-frame and multi-frame workflows). Agents talk to the **`html-video` CLI only** —
they do not import `@html-video/*` packages directly.
