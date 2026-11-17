---
name: html-video
description: >-
  Generate HTML videos via the html-video CLI (Hyperframes base + optional
  Remotion data-frame enhancement). Use when the user asks to create/render a
  video, explainer, data chart animation, social short, promo, or MP4 from HTML
  / article / GitHub content.
---

# html-video

Orchestrate the `html-video` CLI only — never import `@html-video/*` packages.

Full CLI contract: repo-root [`SKILL.md`](../../../SKILL.md). Installable copy:
[`skills/html-video/SKILL.md`](../../../skills/html-video/SKILL.md).

## Session bootstrap

```bash
html-video doctor --json
html-video list-engines --json
html-video list-native-templates --json
html-video search-templates --intent "<user goal>" --top 5 --json
```

## Decision defaults (RFC-09)

- **Base engine**: Hyperframes for all frames by default
- **Remotion**: user-opt-in per data frame via `project-enhance-frame`
- **Native templates**: `frame-data-rollup` (default) · `frame-data-donut` · `frame-data-hbars` · `frame-data-line` · `frame-data-radar`
- **Mixed export**: orchestrator uses ffmpeg concat **filter** (not demuxer)

## Multi-frame workflow

```bash
html-video project-create --name "Explainer" --intent "3-frame story"
html-video project-set-graph $ID --graph-file storyboard.json
html-video project-write-frame $ID --node stats --html-file frames/stats.html
html-video project-enhance-frame $ID --node stats --native-template frame-data-rollup
html-video project-render $ID --output out.mp4 --stream-progress
```

Data nodes: `{ title?, unit?, items: [{ label, value }] }` (aliases `points` / `axes` OK).

## Anti-patterns

- Do not silently switch engines
- Do not import adapters directly
- Do not invent concat flags for mixed-engine MP4 — use `project-render`
