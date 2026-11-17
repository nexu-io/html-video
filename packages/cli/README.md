# @html-video/cli

Command-line interface and local studio server for [html-video](https://github.com/nexu-io/html-video).

**Agent entry point**: repo-root [`SKILL.md`](../../SKILL.md) — coding agents should read that first.

## Install & run

From the monorepo root (after `pnpm build`):

```bash
node packages/cli/dist/bin.js <command> [options]
# or, when linked globally:
html-video <command> [options]
```

## Global flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | on | Emit JSON lines (agent-friendly). Use `--no-json` for human text. |
| `--no-color` | off | Disable ANSI colors |
| `--cwd <path>` | auto | Project root (walks up for `.html-video/` or `pnpm-workspace.yaml`) |

### Response envelope

Success:

```json
{ "status": "ok", "project_id": "proj_…", "project_status": "draft", … }
```

Error (exit code 1):

```json
{ "status": "error", "code": "invalid-input", "message": "…" }
```

**Note:** Project lifecycle is **`project_status`** (`draft` \| `previewed` \| `rendered`). The top-level `status` field is always the envelope (`ok` / `error`).

Progress (during render with `--stream-progress`):

```json
{ "type": "progress", "stage": "frame 1/3: launching browser", "pct": 12 }
```

---

## Environment & diagnostics

| Command | Description |
|---------|-------------|
| `doctor` | Check Node, ffmpeg, ffprobe, Playwright Chromium, Remotion peers, loaded adapters, template count |
| `list-engines` | List registered engine adapters and capabilities |
| `list-native-templates` | List Remotion native templates for `project-enhance-frame` |

```bash
html-video doctor --json
html-video list-engines --json
html-video list-native-templates --json
```

---

## Templates

| Command | Description |
|---------|-------------|
| `search-templates` | Rank templates by intent, aspect, license |
| `inspect-template <id>` | Full metadata for one template |
| `list-native-templates` | Native Remotion data charts (rollup / donut / hbars / line / radar) |

| Option | Command | Description |
|--------|---------|-------------|
| `--intent <text>` | search-templates | Free-text user goal |
| `--aspect <ratio>` | search-templates | e.g. `16:9`, `9:16`, `1:1` |
| `--license-allow <list>` | search-templates | Comma-separated SPDX ids |
| `--top <n>` | search-templates | Max matches (default 5) |

```bash
html-video search-templates --intent "github stars growth chart" --top 3 --json
html-video inspect-template frame-data-chart-nyt --json
```

Maintainers: `pnpm validate-templates` (from repo root) audits all 27 templates for RFC-07 provenance.

---

## Projects — create & metadata

| Command | Description |
|---------|-------------|
| `project-create` | Create a new project |
| `project-list` | List projects (includes `frame_count`, `has_content_graph`) |
| `project-show <id>` | Full project record |
| `project-delete <id>` | Delete project and files |

| Option | Command | Required | Description |
|--------|---------|----------|-------------|
| `--name <text>` | project-create | yes | Display name |
| `--intent <text>` | project-create | | One-sentence description |
| `--aspect <ratio>` | project-create | | `16:9` / `9:16` / `1:1` |
| `--commercial` | project-create | | Mark commercial-use preference |

```bash
html-video project-create --name "Q1 recap" --intent "Quarterly metrics" --aspect 16:9 --json
html-video project-list --json
html-video project-show proj_abc123 --json
```

---

## Projects — assets & variables

| Command | Description |
|---------|-------------|
| `project-add-asset <id>` | Add file, inline text, or inline data asset |
| `project-remove-asset <id>` | Remove asset by id |
| `project-set-template <id>` | Pick single-frame template (fast path) |
| `project-set-var <id>` | Set one template variable |
| `project-set-vars <id>` | Replace all variables from JSON file |

| Option | Command | Description |
|--------|---------|-------------|
| `--file <path>` | project-add-asset | Image / video / audio / data file |
| `--inline-text <text>` | project-add-asset | Text asset |
| `--inline-data-file <path>` | project-add-asset | JSON/CSV embedded as data |
| `--caption <text>` | project-add-asset | Optional caption |
| `--asset <assetId>` | project-remove-asset | Asset to remove |
| `--template <templateId>` | project-set-template | Template id |
| `--key <name>` | project-set-var | Variable name |
| `--value <json>` | project-set-var | JSON value or raw string |
| `--vars-file <path>` | project-set-vars | JSON object file |

```bash
html-video project-set-template $ID --template frame-glitch-title --json
html-video project-set-vars $ID --vars-file vars.json --json
html-video project-set-var $ID --key title --value '"Hello"' --json
```

---

## Projects — preview & render

| Command | Description |
|---------|-------------|
| `project-preview <id>` | Render preview HTML (single-frame fast path) |
| `project-render <id>` | Export MP4 (single-frame or multi-frame) |

| Option | Command | Description |
|--------|---------|-------------|
| `--output <path>` | project-render | Output MP4 path |
| `--stream-progress` | project-render | Emit NDJSON progress lines |

Multi-frame projects (with `frames[]` from content-graph) render each frame then ffmpeg-concat. Mixed hyperframes + Remotion frames re-encode on join automatically.

```bash
html-video project-preview $ID --json
html-video project-render $ID --output ./out.mp4 --stream-progress --json
```

---

## Projects — multi-frame / content-graph (RFC-06)

| Command | Description |
|---------|-------------|
| `project-get-graph <id>` | Read persisted content-graph JSON |
| `project-set-graph <id>` | Write graph from file (validates, topo-sorts) |
| `project-write-frame <id>` | Write HTML for one graph node |
| `project-enhance-frame <id>` | Attach native Remotion template to a **data** frame |
| `project-unenhance-frame <id>` | Revert frame to hyperframes HTML |

| Option | Command | Description |
|--------|---------|-------------|
| `--graph-file <path>` | project-set-graph | Content-graph JSON (required) |
| `--preserve-frames` | project-set-graph | Keep existing frame HTML; sync durations only |
| `--node <nodeId>` | write-frame / enhance / unenhance | Graph node id |
| `--html-file <path>` | project-write-frame | Frame HTML file |
| `--html <text>` | project-write-frame | Inline HTML |
| `--native-template <id>` | project-enhance-frame | e.g. `frame-data-rollup`, `frame-data-donut`, `frame-data-line` |

```bash
html-video project-set-graph $ID --graph-file storyboard.json --json
html-video project-write-frame $ID --node intro --html-file frames/intro.html --json
html-video list-native-templates --json
html-video project-enhance-frame $ID --node stats --native-template frame-data-line --json
html-video project-unenhance-frame $ID --node stats --json
html-video project-get-graph $ID --json
```

---

## Studio

| Command | Description |
|---------|-------------|
| `studio` | Launch browser studio (chat, gallery, frames, soundtrack, export) |

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | 3071 | HTTP port (T9 range 3071–3079) |

```bash
html-video studio --port 3071
# → http://127.0.0.1:3071 — Ctrl+C to stop
```

---

## Typical workflows

### Single-frame (fast path)

```
project-create → project-set-template → project-set-vars → project-preview → project-render
```

### Multi-frame explainer

```
project-create → project-set-graph → project-write-frame (×N) → [project-enhance-frame] → project-render
```

### Agent generation (Studio parity)

LLM emits one ` ```json#content-graph ` block plus ` ```html#<nodeId> ` blocks per frame. CLI users materialize the same via `project-set-graph` + `project-write-frame`.

---

## Development

```bash
pnpm --filter @html-video/cli build
pnpm --filter @html-video/cli test
pnpm --filter @html-video/cli smoke
```

From repo root: `pnpm verify` runs the full quality gate.
