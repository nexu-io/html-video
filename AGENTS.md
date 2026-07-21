# html-video (personalized fork)

> HTML→Video meta-layer for coding agents. Describe a video (or paste an
> article link / GitHub repo) in the Studio chat; a local coding agent turns
> it into a multi-frame, animated HTML video and renders it to a real MP4 on
> your machine. Apache-2.0, no per-render fees, no vendor lock-in.

This is a personalized fork of `nexu-io/html-video`, being customized for the
owner's own course/brand. Read this file before making changes — it reflects
the *current* state of this fork, not the upstream project's history.

`CLAUDE.md` at the repo root is kept identical to this file — different
coding agents look for one or the other (Claude Code reads `CLAUDE.md`, most
others read `AGENTS.md`). Update both together.

## Layout

```
packages/
├── core/                  Project + template registry, MiniMax audio, orchestrator
├── content-graph/         Multi-frame storyboard IR (nodes + edges, topo-sort)
├── runtime/                Coding-agent adapters — detect / spawn / stream
│                          (13 backends: Windsurf, Trae CLI, Claude, Cursor,
│                           Codex, Gemini, Grok, Qwen, OpenCode, Copilot,
│                           Aider, Hermes, Anthropic API)
├── adapter-hyperframes/   Default render engine — real MP4 via headless Chromium + ffmpeg
├── adapter-remotion/      Opt-in native engine for animated data frames only
├── cli/                   `html-video` command + the Studio HTTP server + source fetching
└── project-studio/        Studio web UI (static HTML/CSS/JS, no build step)
templates/                 23 curated video templates (yaml manifest + SKILL.md + source/)
```

Run `pnpm install && pnpm -r build` once, then `node packages/cli/dist/bin.js
studio` to start the Studio at `http://127.0.0.1:3071` (`--port <n>` to
override). `node packages/cli/dist/bin.js doctor` checks the environment.

## What's real vs. roadmap

- **Real**: Hyperframes engine (default, all 23 templates), Remotion as an
  opt-in enhancement for data frames only (`⚡` toggle in the format step —
  `frame-data-rollup` is the only native-Remotion template), multi-frame
  content-graph storyboards, article/GitHub-repo → video, MiniMax audio
  (needs `MINIMAX_API_KEY`), 13 coding-agent backends. Studio UI chrome ships
  in English / Portuguese (pt-BR) / Spanish (Settings → Language), default
  Portuguese, auto-detects the browser's language on first visit.
- **Roadmap, not built**: Motion Canvas / Revideo / Manim adapters, cloud
  render, a drag-and-drop storyboard editor.

## Notable changes made in this fork (read before assuming upstream behavior)

- **Open Design / AMR removed entirely** (agent, login flow, model picker,
  every UI/doc/template mention) — this fork doesn't depend on Open Design's
  account system. If you're diffing against upstream `nexu-io/html-video` and
  see AMR-shaped gaps, that's intentional, not a bug.
- **Studio chat cards no longer hardcode Chinese.** The style/format/confirm/
  edit-menu cards used to ship literal Chinese text that the agent was told to
  reproduce "exactly as shown," which leaked into English/Portuguese
  conversations. They now ship an English *reference* plus an explicit
  "translate into the user's language" instruction, grounded on the user's
  own last message — never on machine-generated JSON (that was the original
  bug: the confirm card's grounding text used to be the raw `[hv-form:submit]`
  JSON blob, which still contained a Chinese-suffixed value and biased the
  model into Chinese). Keep this pattern for any new card: give the LLM an
  English structural reference + a real natural-language grounding quote,
  never a JSON blob, and never a "reproduce this exactly" instruction next to
  non-English text.
- **MiniMax credentials**: only `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` now —
  the `OD_`-prefixed precedence (reusing an Open Design install's key) was
  removed.
- **`i18n.js`'s `DICT` is `{en, pt, es}`**, not `{en, zh}` — the language
  toggle (`AVAILABLE_LOCALES`, `renderSettingsLanguage` in `app.js`) is
  data-driven, so adding/removing a locale only means editing `i18n.js`
  (both the dict and the `settings.language.<code>`/`<code>_sub` self-name
  keys every dict needs for its own button labels). This only affects the
  static Studio UI chrome — it does NOT change what language the chat itself
  replies in (that already follows the user's own messages, see above).
- **Short "move the flow forward" replies** (`isControlPhrase`, `isSkip`,
  `isFreeRein`, the `topicThin` vague-content check, and the export-command
  detector in `app.js`, all in the content/format/confirm phases of
  `studio-server.ts`) now recognize Portuguese and Spanish equivalents too
  (e.g. "continua", "pula", "tanto faz", "lo que sea"), not just Chinese and
  a handful of English words. Without this, a student typing a short PT/ES
  shortcut instead of clicking a card gets that word collected as literal
  video content — the same failure class documented above for "随机".

## Known quirks

- `doctor`'s `chromium` check only tests hardcoded macOS/Linux paths, so it
  always warns on Windows even when Playwright's managed Chromium is
  installed and rendering works fine. Harmless false positive.
- `packages/runtime/test/spawn-utf8.test.ts`'s "CJK split across stdout
  chunks" test fails on Windows (passes the rest of the suite) — pre-existing
  upstream, not something this fork's changes caused.

## Conventions

- Code, comments, and docs stay in **English** — the international default
  every coding agent handles best, and demonstrably the safer choice: this
  repo's old, Chinese-heavy version of this very file measurably biased
  Codex CLI toward answering in Chinese mid-conversation, even with the user
  chatting in Portuguese — Claude Code, reading the (by-then-translated)
  `CLAUDE.md` instead, didn't show the same bias. Don't reintroduce large
  non-English blocks of ambient repo context for the same reason — it
  doesn't matter which language or which agent, the risk is the same.
- User-facing chat content (what the Studio generates) should keep adapting
  live to whichever language the user is actually chatting in — never
  hardcode it, per the pattern above.
