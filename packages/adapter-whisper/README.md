# @html-video/adapter-whisper

On-device, word-level transcription for the html-video **footage-edit** pipeline
(RFC-11). The default ingest back-end: it turns a raw take into a time-coded
transcript locally via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) —
no upload, no per-use fee.

It implements `SourceAdapter` from `@html-video/core`, the ingest-side
counterpart to `EngineAdapter`. Cloud ASR services can implement the same
interface and expose a non-free `licensing`, so an agent can prefer this local
adapter when privacy or cost matters.

## Requirements

| Tool | Install |
|---|---|
| ffmpeg | `brew install ffmpeg` |
| whisper.cpp | `brew install whisper-cpp` (provides `whisper-cli`) |
| a ggml model | download e.g. `ggml-base.en.bin` from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) |

```bash
export HTMLVIDEO_WHISPER_MODEL=/path/to/ggml-base.en.bin
# optional: export HTMLVIDEO_WHISPER_BIN=whisper-cli
```

## Usage

```ts
import { WhisperLocalAdapter } from '@html-video/adapter-whisper';
import { SourceRegistry } from '@html-video/core';

const sources = new SourceRegistry();
sources.register(new WhisperLocalAdapter());

const transcript = await sources
  .get('whisper-local')
  .transcribe(asset, { workDir: '/tmp/hv-work' });
// transcript.words: [{ word: "Hey", start: 0.04, end: 0.22 }, …]
```

> Note: whisper mis-spells proper nouns (e.g. "Thariq" → "Theric") but the
> **timestamps stay accurate**, which is all the cut points need.
