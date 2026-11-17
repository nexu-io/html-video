# @html-video/studio-next (quarantined experiment)

> **Quarantined spike — not part of production Studio.** Read [`QUARANTINE.md`](./QUARANTINE.md) and [`SPIKE-REPORT.md`](./SPIKE-REPORT.md) before touching this package. Production UI: `packages/project-studio/` (port 3071).

Spike to evaluate integrating [`@hyperframes/studio`](https://github.com/heygen-com/hyperframes) (Apache-2.0)
as our editor UI instead of hand-rolling click-to-edit, timeline, property panel, etc.

## Status (2026-05-28)

- ✅ `pnpm dev` boots a Vite + React app on port 3072
- ✅ `import { SourceEditor } from '@hyperframes/studio'` compiles and renders
- ✅ Side-by-side: CodeMirror editor on the left, srcDoc preview on the right
- ⚠️ `useElementPicker` / `Player` / `Timeline` talk to the iframe via
  `postMessage` and require the iframe to host the **hyperframes runtime**
  (responds to `{ source: "hf-parent", type: "control", action: "enable-pick-mode" }`
  etc). Our agent-generated HTML does not have that runtime, so those
  components don't drop in.

## Read this before doing more work here

What we **can** lift directly (no runtime requirement):

- `SourceEditor` — CodeMirror 6 wrapper for HTML / CSS / JS
- `applyPatch`, `parseStyleString`, `mergeStyleIntoTag`, `findElementBlock`
  from `@hyperframes/studio/utils`
- `EaseCurveEditor` (visual GSAP curve picker — works on a value/onChange interface)

What we **can't** lift without bigger work:

- `useElementPicker` (postMessage handshake)
- `Player`, `PlayerControls`, `Timeline`, `VideoThumbnail` (require runtime)
- `NLELayout`, `StudioApp` (pull in their Composition + FileManager data model)

## How to run

```bash
pnpm install   # from monorepo root
pnpm --filter @html-video/studio-next dev
# → http://127.0.0.1:3072
```

Production studio still lives at `packages/project-studio/` (port 3071).
This package is a spike — do not depend on it.
