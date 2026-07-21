---
name: frame-data-rollup
zh_name: "Data Rollup Frame"
en_name: "Data Rollup Frame"
emoji: "📊"
description: "A native Remotion data frame — bars grow from zero by real data via spring physics while the figures roll 0→target in sync. The numbers come alive in a way a static HTML chart can't."
zh_description: "Data Rollup Frame: native Remotion data animation — bars grow from 0 via spring physics driven by real data, numbers roll from 0 to the target value in sync. The 'numbers coming alive' effect a static HTML chart can't achieve."
en_description: "A native Remotion data frame — bars grow from zero by real data via spring physics while the figures roll 0→target in sync."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9), also 9:16 / 1:1"
featured: 0
recommended: 5
tags: ["data", "chart", "bar", "rollup", "count-up", "remotion", "native", "kpi", "frame"]
example_id: sample-frame-data-rollup
example_name: "Data Rollup Frame · This week on GitHub"
example_format: markdown
example_tagline: "Bars grow + numbers roll (native Remotion)"
example_desc: "Data display frame — bars grow from 0 driven by real data + numbers roll 0→target in sync"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/nexu-io/html-video"
  preview:
    # Native Remotion template: no HTML iframe preview. Static poster only.
    type: poster
    entry: preview.png
  design_system:
    requires: false
  example_prompt: "Use the Data Rollup Frame to show my weekly metrics as a bar chart where the bars grow from zero and the numbers count up to their real values. Feed it the actual data; keep it to a handful of bars. This is a Remotion-enhanced data frame — the animation should make the figures feel alive."
  example_prompt_i18n:
    zh-CN: "Use the Data Rollup Frame to turn my weekly metrics into a bar chart: bars grow from 0, numbers roll up to the real values. Feed it real data, and keep the bar count small. This is a Remotion-enhanced data frame — the animation should make the numbers feel alive."
---

**Template: Data Rollup**

**Type**: **Native Remotion template (RFC-08 Phase 2)** — not HTML+GSAP, but React-tsx running directly on Remotion's frame clock (`useCurrentFrame` + `interpolate` + `spring`). This is the motion enhancement a user **actively opts a data frame into**: hyperframes produces static/CSS charts, while this template makes the bars actually grow from the data and the numbers actually roll — visibly different at a glance.

**Intent**: A data display frame — weekly metrics / growth bars / KPIs, where the values should move instead of just sitting there. Meant for one data segment inside an otherwise hyperframes-driven video.

**Canvas**: Defaults to 1920×1080; the whole layout is computed off the real canvas size (`useVideoConfig`), so 9:16 / 1:1 won't get squashed either.

**Data contract (inputProps)**
- `data.items[]` — each item is `{label, value}`, the bars to draw; about 7 max, more gets cramped.
- `data.title?` — top-left title.
- `data.unit?` — number suffix, e.g. `K` / `%`.
- `accent?` / `background?` / `foreground?` — colors, defaulting to burnt orange `#FF5A2C` / near-black `#0E0E10` / paper white `#F5F5F2`.

**Motion structure**
- Each bar grows via `spring()` from 0 to `value/maxValue` height, staggered per bar (0.12s apart) so they cascade in.
- The number rolls from 0 to `value` on the same growth curve as its bar, so the bar and the number settle together.
- The title fades in with a spring + shifts up; each label fades in once its bar has grown to 40%.

**Content rules**
- Feed real data, not placeholder numbers.
- `value` must be a number; non-numbers are treated as 0 (`enhanceFrameNative` should normalize/validate before binding).
- Keep the bar count to 7 or fewer.

**Offline determinism**: system font stack only, inline styles, no external fonts / assets / network — keeps the headless render deterministic and avoids a black frame (the same lesson as the bridge's `neutralizeBlockingResources`).

**Originality**: Original React-tsx. Standard animated-bar-chart vocabulary (count-up + spring growth) implemented from scratch, with no specific upstream source (provenance origin = none).
