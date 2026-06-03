# html-video

<p align="center">
  <img src="docs/assets/hero.png" alt="html-video — HTML becomes video, on your laptop" width="100%" />
</p>

> **HTML becomes video — on your laptop.** Bring your local coding agent (Claude Code · Cursor · Codex · Hermes · or the Anthropic API). Describe a video, or **paste an article link / GitHub repo**, and the agent turns it into a multi-frame, fully animated video — one agent loop, pluggable rendering engines, a curated template gallery, optional AI soundtrack. Apache-2.0, no per-render fees, no vendor lock-in.

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <a href="#supported-agents"><img alt="Agents" src="https://img.shields.io/badge/agents-5%20backends-111?style=flat-square" /></a>
  <a href="#template-gallery"><img alt="Templates" src="https://img.shields.io/badge/templates-15-3ce6ac?style=flat-square" /></a>
  <a href="#turn-a-link-into-a-video"><img alt="Sources" src="https://img.shields.io/badge/from-article%20%C2%B7%20repo%20%C2%B7%20prompt-9b59b6?style=flat-square" /></a>
  <a href="#soundtrack"><img alt="Soundtrack" src="https://img.shields.io/badge/soundtrack-AI%20music%20%2B%20narration-e67e22?style=flat-square" /></a>
  <a href="#quick-start"><img alt="Quickstart" src="https://img.shields.io/badge/quickstart-3%20commands-22a34a?style=flat-square" /></a>
</p>

<!-- Built by the team behind Open Design — these link to its community on purpose. -->
<p align="center">
  <a href="https://github.com/nexu-io/open-design#community"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865f2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://x.com/nexudotio"><img alt="Follow @nexudotio on X" src="https://img.shields.io/badge/follow-%40nexudotio-000000?style=flat-square&logo=x&logoColor=white" /></a>
  <a href="https://github.com/nexu-io/open-design"><img alt="By the Open Design team" src="https://img.shields.io/badge/by-nexu--io%2Fopen--design-ff7043?style=flat-square&logo=github&logoColor=white" /></a>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

---

## Showcase

Every template below is a real, animated single-file HTML video — these are live renders, not mockups. Drop one in, let the agent fill it with your content, export to MP4.

<table>
<tr>
<td width="50%"><img src="docs/assets/templates/frame-data-chart-nyt.png" alt="NYT-style data chart" /></td>
<td width="50%"><img src="docs/assets/templates/frame-glitch-title.png" alt="Glitch title" /></td>
</tr>
<tr>
<td><b>frame-data-chart-nyt</b> · data-viz<br/>Editorial NYT-style animated line chart — headline, annotated data points, source line. For "the number went up" stories.</td>
<td><b>frame-glitch-title</b> · title card<br/>Chromatic-aberration glitch title with scanlines. For openers, drops, and "system online" energy.</td>
</tr>
<tr>
<td><img src="docs/assets/templates/frame-liquid-bg-hero.png" alt="Liquid background hero" /></td>
<td><img src="docs/assets/templates/frame-light-leak-cinema.png" alt="Light leak cinema" /></td>
</tr>
<tr>
<td><b>frame-liquid-bg-hero</b> · hero<br/>Aurora liquid-gradient hero with a centered headline. For product reveals and bold statements.</td>
<td><b>frame-light-leak-cinema</b> · cinematic<br/>Warm film-grain + light-leak cinematic frame. For mood, brand films, "a quiet year" storytelling.</td>
</tr>
<tr>
<td><img src="docs/assets/templates/vfx-text-cursor.png" alt="Typewriter cursor VFX" /></td>
<td><img src="docs/assets/templates/frame-logo-outro.png" alt="Logo outro" /></td>
</tr>
<tr>
<td><b>vfx-text-cursor</b> · VFX<br/>Typewriter text with a blinking terminal cursor. For code-style reveals and CLI demos.</td>
<td><b>frame-logo-outro</b> · outro<br/>Clean animated logo end card. For sign-offs and brand stamps at the end of any video.</td>
</tr>
</table>

…and 9 more, including multi-scene product promos, kinetic type, Swiss-grid data cards, decision-tree explainers, and warm-grain editorial. Browse them live in the studio gallery.

---

## Why this exists

HTML→Video is a real category — but every engine is opinionated, and each wants you to learn *its* authoring model:

| Engine | Paradigm | Tradeoff | In html-video |
|---|---|---|---|
| [Hyperframes](https://github.com/heygen-com/hyperframes) | HTML + CSS + GSAP, agent-skill driven | Single rendering paradigm | ✅ **Shipped** — the default engine; all templates render through it |
| [Remotion](https://www.remotion.dev/) | React components | Source-available, paid above 4 devs | 🗺️ Planned |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) · [Revideo](https://github.com/redotvideo/revideo) | TypeScript generators on canvas | Best for explainers, code-first | 🗺️ Planned |
| [Manim](https://github.com/3b1b/manim) & friends | Math / 3D first | Niche | 🗺️ Researching |

Picking the right engine per use case, learning each model, and stitching them into one workflow costs real engineering time. Most teams pick one and live with its limits.

**html-video is the meta-layer that sits above all of them** — you talk to your agent, it picks the engine and template and renders the video. No new DSL to learn.

> **Status:** the pluggable-engine architecture is in place, but today **Hyperframes is the only wired-up backend**. Remotion, Motion Canvas / Revideo, and Manim are on the roadmap — the adapter interface is designed for them, the adapters aren't built yet. The "In html-video" column above is the single source of truth for what's actually runnable.

---

## At a glance

| | |
|---|---|
| **Coding agents (5)** | Claude Code · Cursor Agent · Codex CLI · Hermes · Anthropic Messages API — auto-detected on your `PATH`, switchable from the top bar. |
| **Article / repo → video** | Paste a URL or GitHub repo; the studio fetches it server-side (handles WeChat 公众号 articles) and builds the video from the real content. |
| **15 templates** | Curated, license-clean patterns: data viz, product promos, social shorts, explainers, kinetic type, transitions — previewed live in the gallery. |
| **Multi-frame storyboards** | A content-graph drives multi-scene videos; edit per-frame text inline, reorder, re-render. |
| **AI soundtrack** | Optional background music + narration via MiniMax, mixed into the MP4 at export. |
| **Studio + CLI** | A local browser studio *and* a scriptable `html-video` CLI. |
| **License** | Apache-2.0 — no per-render fees, no seat caps, no contributor agreements. |

---

## Turn a link into a video

This is what most people reach for: hand your agent a link, get a video back. The agents themselves have no network access, so the studio fetches the source **server-side** and feeds the real content into the generation prompt — no copy-pasting article bodies.

```
You:   做一个解读视频  https://mp.weixin.qq.com/s/…
Agent: 好，我读完了《用嘴剪视频的时代来了？…》这篇文章 — 这就基于它生成。下一步选风格。
→      multi-frame explainer, built from the article's actual points
```

- **Web article** → fetched and flattened to Markdown. Server-rendered pages like **WeChat 公众号** articles work out of the box.
- **GitHub repo** → description, top-level structure, and README pulled via the public API — great for "explain this open-source project" videos.
- **Just a prompt** → describe the topic and the agent writes the content from scratch.

Whatever the source, it becomes the material the video is actually built from.

---

## Quick start

```bash
pnpm install
pnpm -r build
node packages/cli/dist/bin.js studio    # opens the studio at http://127.0.0.1:3071
```

In the studio: pick a template (or just describe a video / paste a link), chat with your agent, edit per-frame text, add a soundtrack, and export MP4.

CLI utilities:

```bash
node packages/cli/dist/bin.js doctor                 # detect installed agents + engines
node packages/cli/dist/bin.js search-templates --intent "github stars race" --top 3
```

---

## Supported agents

Auto-detected on your `PATH`; switch the active one from the studio's top bar.

| Agent | Detection | Invocation |
|---|---|---|
| **Claude Code** | `claude` | `claude --print`, prompt via stdin |
| **Cursor Agent** | `cursor-agent` | `cursor-agent --print` |
| **Codex CLI** | `codex` | `codex exec`, prompt via stdin |
| **Hermes** | `hermes` | Hermes ACP CLI |
| **Anthropic API** | BYOK | Direct Messages API — the default when no CLI is pinned |

No CLI installed? Set an Anthropic key and the studio talks to the Messages API directly.

---

## Soundtrack

Give the finished video a voice. In **Settings → Audio**, add a MiniMax API key, then in the per-project **Soundtrack** panel:

- **Background music** — describe a mood (`calm cinematic ambient, slow build`); MiniMax generates an instrumental track.
- **Narration** — type a script; MiniMax reads it (TTS).

Both are mixed into the exported MP4 (music ducked under the voice, optional fade-in/out) via ffmpeg. No key configured? The rest of the studio works unchanged.

---

## Architecture

```
packages/
├── core/                  Project / Asset / ContentGraph types, registries, orchestrator,
│                          MiniMax provider + ffmpeg audio mux
├── content-graph/         Multi-frame storyboard IR (nodes + edges, topo-sort)
├── runtime/               Agent runtime — detect / spawn / stream
│                          (Claude · Cursor · Codex · Hermes · Anthropic API)
├── adapter-hyperframes/   First reference engine adapter (HTML + CSS + GSAP)
├── cli/                   `html-video` command + the studio HTTP server + source fetching
└── project-studio/        Browser studio UI (chat, template gallery, frames, soundtrack, export)
templates/                 15 curated video templates
research/                  RFCs (engine adapter / template metadata / agent skill / content-graph)
```

---

## Roadmap

- [x] Engine adapter spec — one interface, N backends
- [x] Template metadata format — license-first, agent-readable
- [x] Multi-frame storyboard workflow (content-graph)
- [x] Studio: live template gallery, agent switcher, per-frame text editing
- [x] Source material: article / GitHub-repo → video
- [x] AI soundtrack (MiniMax music + narration), mixed at export
- [ ] Real Hyperframes upstream render (replace the adapter stub)
- [ ] Adapters for Remotion / Motion Canvas / Revideo
- [ ] Agent skill packages + a template marketplace

---

## References & lineage

| Project | Role here |
|---|---|
| [Open Design](https://github.com/nexu-io/open-design) | Sister project — the design-agent meta-layer; same team, shared philosophy |
| [HTML Anything](https://github.com/nexu-io/html-anything) | Sister project — HTML for *static* deliverables; html-video is the *motion* side |
| [Hyperframes](https://github.com/heygen-com/hyperframes) | First engine adapter; the HTML+GSAP rendering paradigm |

## License

[Apache-2.0](LICENSE)

## Built by

[nexu-io](https://github.com/nexu-io) — the team behind [Open Design](https://github.com/nexu-io/open-design). Join the [Discord](https://github.com/nexu-io/open-design#community) · follow [@nexudotio](https://x.com/nexudotio).
