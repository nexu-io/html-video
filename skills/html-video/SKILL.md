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

Canonical CLI contract (repo root): [`SKILL.md`](../../SKILL.md). This skill adds
installable agent frontmatter + decision defaults.

## Session bootstrap

```bash
html-video doctor --json
html-video list-engines --json
html-video list-native-templates --json
html-video search-templates --intent "<user goal>" --top 5 --json
```

Envelope: `{ "status": "ok", ... }` or `{ "status": "error", "code", "message" }`.
Project lifecycle field is `project_status` (`draft` | `previewed` | `rendered`).

## Decision defaults (RFC-09)

| Situation | Do this |
|---|---|
| Default frames | Hyperframes (HTML + Chromium record) |
| Data frame needs rolling numbers / growing charts | Ask user, then `project-enhance-frame --native-template <id>` |
| Multi-scene explainer | Content-graph path (not single-frame fast path) |
| Mixed engines in one MP4 | Orchestrator uses ffmpeg concat **filter** automatically |

Native Remotion templates (enhance pickers):

| id | Chart |
|---|---|
| `frame-data-rollup` | Vertical bars + count-up (default) |
| `frame-data-donut` | Donut / ring |
| `frame-data-hbars` | Horizontal bars |
| `frame-data-line` | Line / area trend |
| `frame-data-radar` | Radar / spider |

## Single-frame fast path

```bash
html-video project-create --name "Demo" --intent "One chart slide" --aspect 16:9
html-video project-set-template $ID --template frame-data-chart-nyt
html-video project-set-vars $ID --vars-file vars.json
html-video project-preview $ID
html-video project-render $ID --output out.mp4 --stream-progress
```

## Multi-frame (content-graph)

```bash
html-video project-create --name "Explainer" --intent "3-frame story"
html-video project-set-graph $ID --graph-file storyboard.json
html-video project-write-frame $ID --node intro --html-file frames/intro.html
html-video project-write-frame $ID --node stats  --html-file frames/stats.html
html-video project-write-frame $ID --node outro --html-file frames/outro.html
html-video project-enhance-frame $ID --node stats --native-template frame-data-rollup
# Revert: html-video project-unenhance-frame $ID --node stats
html-video project-render $ID --output out.mp4 --stream-progress
```

Data nodes should carry `{ title?, unit?, items: [{ label, value }] }` (or
`points` / `axes`). The CLI remaps series keys to match the chosen native template.

### LLM one-shot protocol (Studio parity)

1. One fenced ` ```json#content-graph ` block
2. One fenced ` ```html#<nodeId> ` block per node

## Anti-patterns

- Do not pick a template silently — show top matches with reasons
- Do not silently switch engines; Remotion enhance is user-opt-in
- Do not import adapters or write engine-native project files by hand
- Do not use concat demuxer for mixed-engine exports (orchestrator handles this)

## Install

From the html-video repo:

```bash
bash scripts/install-agent-skill.sh
# → ~/.claude/skills/html-video/SKILL.md
# → ~/.cursor/skills/html-video/SKILL.md (optional personal copy)
```

Project-scoped Cursor skill already ships at `.cursor/skills/html-video/`.
