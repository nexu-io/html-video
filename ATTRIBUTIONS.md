# Attributions

html-video is licensed under Apache-2.0. Some of its bundled video **templates** are
derived from open-source design skills under permissive licenses. This file records every
upstream we built on, its real copyright holder, and its license, as required by the
upstream licenses and by [RFC-07](research/2026-06-04-spec-07-ppt-to-template.md) (our
PPT-skill → template conversion standard).

> **What "derived" means here**: we transformed static presentation/slide designs into
> animated [hyperframes](https://github.com/heygen-com/hyperframes) video templates —
> rebuilt as original CSS/SVG keyframe timelines, re-coloured/re-typed where noted, with
> our own sample data. No upstream source code is copied verbatim. The upstream licenses
> (MIT) permit commercial use and derivative works; we attribute them regardless.

Many of these design styles are themselves homages to real-world design studios. Where a
template is inspired by a specific studio, we record that as the **L1 origin** in the
template's `provenance` block — as a factual statement of inspiration, never as a claim of
affiliation or endorsement. Studio names are **not** used as template names.

---

## Upstream design skills

### huashu-design

- **Copyright holder**: alchaincyf (花叔 · 花生) © 2026
- **License**: MIT
- **Source**: https://github.com/alchaincyf/huashu-design
- **Used by templates**:
  - `frame-pentagram-stat` — via `assets/showcases/ppt/ppt-pentagram.html`
    (L1 inspiration: Pentagram / Michael Bierut)
  - `frame-build-minimal` — via `assets/showcases/ppt/ppt-build.html`
    (L1 inspiration: Build, London design studio)
  - `frame-takram-organic` — via `assets/showcases/ppt/ppt-takram.html`
    (L1 inspiration: Takram, Japanese design firm)

### frontend-slides

- **Copyright holder**: Zara Zhang © 2025
- **License**: MIT
- **Source**: https://github.com/zarazhangrui/frontend-slides
- **Used by templates**:
  - `frame-bold-signal` — via `STYLE_PRESETS.md` (preset "Bold Signal")
  - `frame-creative-voltage` — via `STYLE_PRESETS.md` (preset "Creative Voltage")
  - `frame-electric-studio` — via `STYLE_PRESETS.md` (preset "Electric Studio")

  (These three are original presets composed by the skill author — no specific real-world
  studio is the L1 origin.)

---

## Original html-video templates (no L2 upstream)

These were authored directly for html-video (native Remotion compositions). See each
template's `provenance.origin` / `via_skill` for detail.

- `frame-data-rollup` — native Remotion bar chart + count-up
- `frame-data-donut` — native Remotion donut chart
- `frame-data-hbars` — native Remotion horizontal bar chart
- `frame-data-line` — native Remotion line chart
- `frame-data-radar` — native Remotion radar / spider chart

---

## Studio names referenced as L1 inspiration

The following real-world design studios / designers are named in template `provenance.origin`
purely as a record of stylistic inspiration. html-video is **not affiliated with, endorsed by,
or sponsored by** any of them.

- **Pentagram** (and Michael Bierut) — pentagram.com
- **Build** — London design studio
- **Takram** — takram.com

---

*Per-template details (the full three-layer `provenance` block: origin / via_skill /
transformation) live in each template's `template.html-video.yaml`.*
