# RFC-10 · FishAudio TTS provider for narration

- **Date**: 2026-06-15
- **Status**: Draft (pending review)
- **Author**: fancy
- **Scope**: Add FishAudio as a second narration (text-to-speech) provider alongside the existing MiniMax integration, selectable per workspace. Music generation stays MiniMax-only (FishAudio has none).

## 1. Context

Narration today is hard-wired to MiniMax across ~6 files:

| Layer | File | What it does |
|---|---|---|
| Provider | `packages/core/src/minimax.ts` | `resolveMinimaxCredentials` + `generateTts` (POST `/t2a_v2`) + `generateMusic` |
| Config | `packages/cli/src/media-config.ts` | `MediaConfigStore` persists key to `.html-video/media-config.json` |
| Server | `packages/cli/src/studio-server.ts` | `POST /api/projects/:id/generate-audio` (SSE) + `/api/config/minimax` |
| Mux | `packages/core/src/project.ts` | stores MP3 asset, muxes into export via ffmpeg |
| UI | `packages/project-studio/public/app.js` | Settings → Audio panel + Soundtrack panel (6 hard-coded voices) |
| i18n | `packages/project-studio/public/i18n.js` | `settings.audio.*` strings say "MiniMax" |

There is **no provider abstraction** — the request shape (`voice_setting`/`audio_setting`), the JSON+hex+`base_resp` response envelope, the region-bound keys, and the fixed 6-voice catalog are all MiniMax-specific.

We use FishAudio's TTS heavily and want it as a first-class narration backend.

## 2. Verified FishAudio API behaviour

Tested live against `api.fish.audio` with a real key (raw `curl` + `ffprobe`):

- **TTS**: `POST https://api.fish.audio/v1/tts`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `model: <s1|s2-pro>`. Body `{ text, format:"mp3", reference_id? }`. Response is **raw binary audio** (`audio/mpeg`), `Transfer-Encoding: chunked`. No JSON envelope, no hex.
  - `s1` and `s2-pro` both verified. `reference_id` optional → default voice. `prosody.speed`/`format:wav` verified working.
  - **`model` header is documented "required" but the live API accepts its absence** (server default). We send it explicitly anyway.
  - **No duration is returned** by `/v1/tts`. (See §4 — this turns out not to matter.)
  - Error codes are standard HTTP: 401 unauthorized, 402 no credit, 422 validation.
- **Voices**: `GET https://api.fish.audio/model?self=true&title=<q>&page_size=N` → `{ total, items:[{ _id, title, languages, visibility, samples:[{ audio }] }] }`. `_id` is the `reference_id`; `samples[].audio` is a preview MP3 URL. The test account holds 6554 own models → a searchable picker is required, not a plain dropdown.
- **Single global host** — no international/China region split (unlike MiniMax).
- FishAudio also has ASR and voice-clone creation; **out of scope** here.

## 3. Key finding that simplifies the design

`generateTts` returns `durationSec` (from MiniMax `extra_info.audio_length`), but **nothing downstream consumes it** — it appears only in the cosmetic `providerNote` string. The "Fit timing to narration" feature (`studio-server.ts:1229`) re-paces frames by **narration text character count**, not audio duration. So FishAudio returning no duration is harmless; `durationSec` stays optional and cosmetic.

## 4. Design (provider abstraction)

### 4.1 Core — new `packages/core/src/fishaudio.ts`

Mirrors `minimax.ts`'s narration surface (music intentionally absent):

- `resolveFishAudioCredentials(env)` → `{ apiKey, baseUrl, model } | null`
  - key: `FISH_AUDIO_API_KEY` → `FISHAUDIO_API_KEY`
  - base: `FISH_AUDIO_BASE_URL` → default `https://api.fish.audio` (host only; we append `/v1/tts` and `/model`)
  - model: `FISH_AUDIO_MODEL` → default `s1`
- `generateFishTts({ text, referenceId?, creds, signal? })` → POST `/v1/tts`, `model` header, `format:"mp3"`, read `arrayBuffer()` → `TtsAudioResult`. Maps 401/402/422 to friendly `HtmlVideoError('render-failed', …)`.
- `listFishVoices({ creds, query?, pageSize? })` → GET `/model?self=true&title=<q>` → trimmed `[{ id, title, languages, sampleUrl }]`.

Generalise `MinimaxAudioResult` → shared `TtsAudioResult { bytes; ext; providerNote; durationSec? }` (`ext` widened to `string`; **v1 FishAudio always emits `.mp3`** so the export mux assumptions are untouched). Re-export from `core/src/index.ts`.

### 4.2 Config — `packages/cli/src/media-config.ts`

`media-config.json` grows from `{ minimax }` to:

```json
{
  "narrationProvider": "minimax" | "fishaudio",
  "minimax":   { "apiKey": "…", "baseUrl": "…" },
  "fishaudio": { "apiKey": "…", "baseUrl": "…" }
}
```

Add `getFishAudioStatus / setFishAudio / clearFishAudio / resolveFishAudio` (mirroring the MiniMax methods, minus region) and `getNarrationProvider / setNarrationProvider`. Existing MiniMax methods stay (music still uses them). `narrationProvider` defaults to `minimax` for backward compat.

### 4.3 Server — `packages/cli/src/studio-server.ts`

- `generate-audio` handler: **music** branch unchanged (always MiniMax). **narration** branch resolves the active `narrationProvider` and routes to `generateFishTts` or `generateTts`. If the chosen provider has no key → the existing friendly "configure your key" SSE failure, naming the right provider.
- New endpoints:
  - `GET/POST/DELETE /api/config/fishaudio` — mirror `/api/config/minimax`.
  - `GET/POST /api/config/narration-provider` — read/set the active provider.
  - `GET /api/fishaudio/voices?q=<query>` — proxy `listFishVoices` for the picker (server holds the key; the browser never sees it).

### 4.4 UI — `packages/project-studio/public/app.js` + `i18n.js`

- **Settings → Audio**: a provider toggle (MiniMax / FishAudio) driving `narrationProvider`. FishAudio pane = key input + a note that the model is controlled by `FISH_AUDIO_MODEL` (default `s1`); **region selector hidden** (MiniMax-only). Panel title becomes provider-aware (no longer a literal "MiniMax").
- **Soundtrack → Narration**: when `narrationProvider==='fishaudio'`, the voice control becomes a **searchable picker** — a text box → debounced `GET /api/fishaudio/voices?q=` → result list (title · language · ▶ sample) → selecting stores `reference_id` (empty = default voice). When `minimax`, the existing 6-voice dropdown is shown. Volume slider (post-mix dB) is shared, unchanged.
- i18n: generalise `settings.audio.*`; add FishAudio strings (en + zh-CN).

### 4.5 Non-goals (v1)

ASR; voice-clone creation; per-request speed / temperature / format UI (matches the current MiniMax narration UI, which exposes only voice + volume); any music via FishAudio.

## 5. Files touched

`core/src/fishaudio.ts` (new), `core/src/minimax.ts` (result-type generalisation only), `core/src/index.ts`, `cli/src/media-config.ts`, `cli/src/studio-server.ts`, `project-studio/public/app.js`, `project-studio/public/i18n.js`. No change to the export/mux path or `project.ts`.

## 6. Verification plan (must be real, not "tsc passes")

1. `pnpm -r build` + `pnpm --filter @html-video/cli smoke` green.
2. Unit: `resolveFishAudioCredentials` env precedence; `generateFishTts` request shape + binary decode (mock fetch); error-code mapping.
3. **Real API** (with the provided key, never committed): `generateFishTts` → real MP3, `ffprobe` confirms valid audio; `listFishVoices` returns items.
4. **End-to-end in studio** (chrome-devtools): configure FishAudio key → switch provider → search + pick a voice → generate narration → asset appears + plays. Capture evidence (screenshot / ffprobe of the generated asset).
5. Regression: with `narrationProvider=minimax`, the existing flow is byte-for-byte unchanged.

## 7. Open questions

- Should the voice picker default `self=true` (own models) or also allow browsing the public marketplace? v1 = `self=true` only.
- Persist a small "recently used voices" shortlist later? Deferred.
