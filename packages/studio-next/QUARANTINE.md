# Quarantined spike — do not build on this

**Verdict (2026-05-29):** Rebuilding html-video Studio on Hyperframes `NLELayout` / `Player` / `Timeline` is **not viable** for our agent-generated HTML workflow. See [`SPIKE-REPORT.md`](./SPIKE-REPORT.md).

## Status

| What | Detail |
|------|--------|
| Purpose | Research only — evaluate `@hyperframes/studio` leaf components |
| Production Studio | `packages/project-studio/` (port **3071**) |
| This package | Port **3072**, optional `pnpm --filter @html-video/studio-next dev` |
| Monorepo scripts | **Excluded** from root `pnpm build`, `typecheck`, and `test` |
| Biome | Ignored via `biome.json` |

## Safe to borrow later

- `SourceEditor` (CodeMirror wrapper)
- Pure utils: `applyPatch`, `parseStyleString`, `mergeStyleIntoTag`, `findElementBlock`
- `EaseCurveEditor`

## Do not depend on

- `useElementPicker`, `Player`, `Timeline`, `NLELayout`, `StudioApp` (require HF runtime in iframe)

New Studio work belongs in **`packages/project-studio/`** and **`packages/cli/src/studio-*.ts`**.
