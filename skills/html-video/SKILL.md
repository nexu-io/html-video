# html-video — Agent Skill

> HTML→Video meta-layer. **Talk to the CLI only** — never import `@html-video/*` packages directly.

Installable copies: [`skills/html-video/SKILL.md`](skills/html-video/SKILL.md) (Claude Code) · [`.cursor/skills/html-video/`](.cursor/skills/html-video/) (Cursor project skill).  
`bash scripts/install-agent-skill.sh` → `~/.claude/skills/html-video/`.

## Bootstrap

```bash
pnpm install && pnpm -r build
html-video doctor --json
html-video list-engines --json
html-video list-native-templates --json
html-video search-templates --intent "<user goal>" --top 5 --json
```

All commands default to `--json`. Envelope: `{ "status": "ok", ... }` or `{ "status": "error", "code", "message" }`.
Project lifecycle state is **`project_status`** (`draft` | `previewed` | `rendered`), not `status`.

## Single-frame workflow (fast path)

```bash
html-video project-create --name "Demo" --intent "One chart slide" --aspect 16:9
html-video project-set-template $ID --template frame-data-chart-nyt
html-video project-set-vars $ID --vars-file vars.json
html-video project-preview $ID
html-video project-render $ID --output out.mp4 --stream-progress
```

## Multi-frame workflow (content-graph)

Use when the user wants an explainer / multi-scene video (RFC-06).

```bash
html-video project-create --name "Explainer" --intent "3-frame story"

# 1. Write storyboard JSON (nodes + edges). Validates cycles/ids.
html-video project-set-graph $ID --graph-file storyboard.json

# 2. Write one HTML file per graph node
html-video project-write-frame $ID --node intro --html-file frames/intro.html
html-video project-write-frame $ID --node stats  --html-file frames/stats.html
html-video project-write-frame $ID --node outro --html-file frames/outro.html

# 3. Optional: enhance a *data* frame with native Remotion animation
html-video list-native-templates --json   # rollup | donut | hbars | line | radar | kpi-pulse
html-video project-enhance-frame $ID --node stats --native-template frame-data-rollup
# Revert: html-video project-unenhance-frame $ID --node stats

# 4. Export (per-frame render + ffmpeg concat)
html-video project-render $ID --output out.mp4 --stream-progress
```

Read back the graph: `html-video project-get-graph $ID`

Update pacing only (keep rendered HTML): `html-video project-set-graph $ID --graph-file updated.json --preserve-frames`

### Agent generation protocol (Studio parity)

When generating from an LLM in one shot, emit:

1. One fenced ` ```json#content-graph ` block
2. One fenced ` ```html#<nodeId> ` block per node

The studio server parses this automatically; CLI users write graph + frames via the commands above.

Data nodes should include structured series data:

```json
{ "title": "…", "unit": "K", "items": [{ "label": "A", "value": 10 }] }
```

(`points` / `axes` aliases are accepted; the CLI remaps to the chosen native template.)

For a **single KPI** enhance (`frame-kpi-pulse`):

```json
{ "title": "…", "label": "…", "value": 27, "unit": "", "caption": "…" }
```

## Project maintenance

```bash
html-video project-list
html-video project-show $ID
html-video project-add-asset $ID --file ./logo.png
html-video project-set-var $ID --key title --value '"Hello"'
html-video project-delete $ID
```

## Templates & engines

- Default engine: **hyperframes** (HTML + headless Chromium → MP4)
- **Remotion** native templates (`engine: remotion`) attach via `project-enhance-frame` (user opt-in, RFC-09):
  - `frame-data-rollup` — vertical bars + count-up (default)
  - `frame-data-donut` — donut / ring
  - `frame-data-hbars` — horizontal bars
  - `frame-data-line` — line / area trend
  - `frame-data-radar` — radar / spider
  - `frame-kpi-pulse` — single hero KPI (spring + count-up + ring; not a chart)
- Mixed-engine exports use ffmpeg concat **filter** (not demuxer) — orchestrator handles this

```bash
html-video inspect-template frame-data-rollup --json
pnpm validate-templates   # RFC-07 provenance + file checks
```

## Studio (interactive)

```bash
html-video studio --port 3071
```

Browser UI for chat-driven generation, frame strip (per-frame Remotion chart picker), soundtrack, export. Prefer CLI for scripted/agent batch flows.

## Quality gates (maintainers)

```bash
pnpm verify          # build + typecheck + lint + validate-templates + test + fast smoke
pnpm smoke           # full smoke incl. MP4 (needs Playwright Chromium + ffmpeg)
HV_SMOKE_FAST=1 pnpm smoke   # skip MP4 render
```
