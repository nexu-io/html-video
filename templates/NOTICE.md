# Template attributions

> **Canonical mapping (RFC-07 three-layer provenance)**: see repo-root [`ATTRIBUTIONS.md`](../ATTRIBUTIONS.md).
> This file is a legacy quick index; per-template `provenance` blocks in each
> `template.html-video.yaml` are authoritative.

Several templates in this directory are forked from upstream projects.
Original licenses apply; see each template's `template.html-video.yaml`
`assets_attribution` block for the canonical source URL.

## Apache-2.0 — `heygen-com/hyperframes` (registry/examples)

The following templates are direct forks (HTML + composition files unchanged
besides being placed under our directory layout) of
[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes/tree/main/registry/examples):

- `frame-warm-grain` ← examples/warm-grain
- `frame-swiss-grid` ← examples/swiss-grid
- `frame-kinetic-type` ← examples/kinetic-type
- `frame-nyt-graph` ← examples/nyt-graph
- `frame-decision-tree` ← examples/decision-tree
- `frame-play-mode` ← examples/play-mode
- `frame-product-promo` ← examples/product-promo
- `frame-vignelli` ← examples/vignelli

Per the Apache-2.0 license:
- Copyright © Hyperframes / heygen-com.
- Redistributed unmodified, with the upstream LICENSE preserved at
  the repo root and this NOTICE.md acknowledging the source.
- Each template's `template.html-video.yaml` records the upstream URL
  in `assets_attribution`.

## MIT — `nateherkai/hyperframes-student-kit`

The following templates derive from
[nateherkai/hyperframes-student-kit](https://github.com/nateherkai/hyperframes-student-kit/tree/main/video-projects).
We keep the composition layout + animation structure but replace
brand-specific copy / assets with generic placeholders so the agent
can repaint per-project content:

- `frame-product-promo-30s` ← video-projects/linear-promo-30s
  (Linear logo + screenshots replaced with placeholder SVGs / 1×1
  PNGs; sound effects kept; 30-second multi-scene promo flow
  preserved.)

Per the MIT license:
- Copyright © Nate Herk.
- We attribute the upstream URL in the template's
  `assets_attribution`.

## Original templates (Apache-2.0)

These were authored for html-video and are licensed Apache-2.0:

- `frame-data-chart-nyt`
- `frame-glitch-title`
- `frame-light-leak-cinema`
- `frame-liquid-bg-hero`
- `frame-logo-outro`
- `vfx-text-cursor`

## Adding a new template

When forking a new third-party template:

1. Copy source verbatim under `templates/frame-<slug>/`.
2. Write `template.html-video.yaml` with `license:` matching the
   upstream license, and an `assets_attribution` block pointing at
   the upstream URL.
3. Add a row to this file under the matching license section.
4. If the upstream license requires it (Apache-2.0, BSD, MPL), copy
   the license text as `templates/frame-<slug>/LICENSE`.
