/**
 * @html-video/adapter-whisper — RFC-11 source adapter (whisper.cpp, local).
 *
 * Transcribes a raw take into a word-level {@link Transcript} entirely on the
 * user's machine: ffmpeg extracts 16 kHz mono PCM, then `whisper-cli`
 * (whisper.cpp) emits per-word segments which we parse into {word, start, end}.
 * No upload, no per-use fee — the default ingest back-end. Cloud ASR adapters
 * can implement the same {@link SourceAdapter} interface and expose a non-free
 * `licensing` so an agent can avoid them when privacy / cost matters.
 *
 * Tooling (both surfaced with a friendly hint if missing):
 *   - ffmpeg        — `brew install ffmpeg`
 *   - whisper-cli   — `brew install whisper-cpp`  (binary configurable)
 *   - a ggml model  — set HTMLVIDEO_WHISPER_MODEL=/path/to/ggml-base.en.bin
 */
import { HtmlVideoError } from '@html-video/core';
import type { Asset, RenderContext, SourceAdapter, Transcript } from '@html-video/core';

/** Override the whisper.cpp binary (default `whisper-cli`). */
const WHISPER_BIN = process.env.HTMLVIDEO_WHISPER_BIN || 'whisper-cli';
/** Override the ggml model path (no default — set the env var or pass in opts). */
const MODEL_ENV = 'HTMLVIDEO_WHISPER_MODEL';

export interface WhisperAdapterOptions {
  /** Absolute path to a ggml model. Falls back to $HTMLVIDEO_WHISPER_MODEL. */
  modelPath?: string;
  /** Whisper language ('en', 'auto', …). Default 'auto'. */
  language?: string;
}

export class WhisperLocalAdapter implements SourceAdapter {
  readonly id = 'whisper-local';
  readonly name = 'Whisper (whisper.cpp, local)';
  readonly capabilities = {
    local: true,
    wordTimestamps: true,
    languages: 'auto' as const,
    licensing: 'free-osi' as const,
  };

  constructor(private opts: WhisperAdapterOptions = {}) {}

  private modelPath(): string {
    const m = this.opts.modelPath || process.env[MODEL_ENV];
    if (!m) {
      throw new HtmlVideoError(
        'invalid-input',
        `No whisper model configured. Download one (e.g. ggml-base.en.bin from ` +
          `https://huggingface.co/ggerganov/whisper.cpp) and set ${MODEL_ENV}=/path/to/model.bin`,
      );
    }
    return m;
  }

  async transcribe(asset: Asset, ctx: RenderContext): Promise<Transcript> {
    if (!asset.path) {
      throw new HtmlVideoError('invalid-input', `Asset "${asset.id}" has no file path to transcribe`);
    }
    const { join } = await import('node:path');
    const { readFile, mkdir } = await import('node:fs/promises');

    const model = this.modelPath();
    const work = ctx.workDir;
    await mkdir(work, { recursive: true });
    const wav = join(work, `${asset.id}.wav`);
    const prefix = join(work, `${asset.id}.transcript`);

    // 1. extract 16 kHz mono PCM (whisper.cpp's expected input)
    await run(
      'ffmpeg',
      ['-y', '-i', asset.path, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav, '-loglevel', 'error'],
      'ffmpeg (wav extract)',
      'ffmpeg not found on PATH. Install with `brew install ffmpeg`.',
    );

    // 2. word-level transcription: -ml 1 (one token/segment) + -sow (split on word)
    const args = ['-m', model, '-f', wav, '-ml', '1', '-sow', '-oj', '-of', prefix];
    const lang = this.opts.language;
    if (lang && lang !== 'auto') args.push('-l', lang);
    await run(
      WHISPER_BIN,
      args,
      'whisper-cli',
      `${WHISPER_BIN} not found on PATH. Install with \`brew install whisper-cpp\` (or set HTMLVIDEO_WHISPER_BIN).`,
    );

    // 3. parse whisper.cpp JSON → word list
    const raw = await readFile(`${prefix}.json`, 'utf8');
    const parsed = JSON.parse(raw) as {
      transcription?: { text: string; offsets: { from: number; to: number } }[];
      result?: { language?: string };
    };
    const words = (parsed.transcription ?? [])
      .filter((s) => s.text.replace(/[^a-zA-Z]/g, '').length > 0)
      .map((s) => ({
        word: s.text.trim(),
        start: s.offsets.from / 1000,
        end: s.offsets.to / 1000,
      }));

    return {
      clipAssetId: asset.id,
      words,
      language: parsed.result?.language,
      source: this.id,
    };
  }
}

/** Default-configured instance (reads model path from $HTMLVIDEO_WHISPER_MODEL). */
const whisperLocal = new WhisperLocalAdapter();
export default whisperLocal;

async function run(bin: string, args: string[], label: string, missingHint: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolveFn, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      reject(new HtmlVideoError(err.code === 'ENOENT' ? 'invalid-input' : 'render-failed', err.code === 'ENOENT' ? missingHint : String(err)));
    });
    proc.on('exit', (code: number | null) => {
      if (code === 0) resolveFn();
      else reject(new HtmlVideoError('render-failed', `${label} exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
}
