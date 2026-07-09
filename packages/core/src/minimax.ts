/**
 * @html-video/core — MiniMax audio provider.
 *
 * MiniMax exposes speech (`/t2a_v2`) and music (`/music_generation`) under the
 * same host, the same Bearer key, and the same response shape — both wrap the
 * payload in a `base_resp` envelope and return the audio as a hex string in
 * `data.audio`. So one provider + one key covers both narration and music.
 *
 * The request/parse pattern is ported from open-design's `renderMinimaxTTS`
 * (apps/daemon/src/media.ts): fetch → Bearer → check `base_resp.status_code`
 * (an HTTP 200 can still be a logical failure) → `Buffer.from(hex, 'hex')`.
 *
 * Credentials are read from the environment so the studio works without any
 * config file; a missing key yields `null` from {@link resolveMinimaxCredentials}
 * and callers report it gracefully instead of throwing.
 */

import { HtmlVideoError } from './errors.js';

/** Default base URL. The old `api.minimaxi.chat` host is RETIRED server-side
 *  (issue #4). MiniMax now has two region-bound endpoints — international
 *  `api.minimax.io` and China `api.minimaxi.com` — and a key only authenticates
 *  against its own region. We default to international; override via
 *  OD_MINIMAX_BASE_URL / MINIMAX_BASE_URL (or the Studio Settings UI). */
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

/** Hard ceiling for a single MiniMax request. Music generation is slow but a
 *  request that hasn't returned in 2 minutes is hung, not slow. */
const MINIMAX_REQUEST_TIMEOUT_MS = 120_000;
/** Fast turbo speech tier (same default open-design ships). */
const MINIMAX_TTS_MODEL = 'speech-02-turbo';
/**
 * Music model. We use music-1.5, NOT the newer music-2.6 family: 2.6's
 * synchronous music_generation call never returns for our key (verified: 180s
 * with no response), whereas music-1.5 returns audio synchronously in ~50s.
 * Trade-off: 1.5 has no `is_instrumental` flag and REQUIRES a `lyrics` field,
 * so for instrumental soundtracks we pass a minimal humming placeholder.
 */
const MINIMAX_MUSIC_MODEL = 'music-1.5';

export interface MinimaxCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface MinimaxAudioResult {
  /** Decoded audio bytes (MP3). */
  bytes: Buffer;
  /** File extension to store under. */
  ext: '.mp3';
  /** Human-readable note of what was produced (provider · model · size). */
  providerNote: string;
  /** Reported duration in seconds, if the API surfaced it. */
  durationSec?: number;
}

export interface MinimaxVideoResult {
  /** Decoded video bytes (MP4). */
  bytes: Buffer;
  /** File extension to store under. */
  ext: '.mp4';
  /** Human-readable note of what was produced (provider · model · size). */
  providerNote: string;
  /** Provider task id, useful for support/debugging. */
  taskId: string;
  /** Provider file id, when surfaced by the API. */
  fileId?: string;
}

/**
 * Resolve MiniMax credentials from the environment. Returns `null` (not throw)
 * when no key is set, so the studio can show a friendly "configure your key"
 * message instead of a 500.
 *
 * Key precedence:  OD_MINIMAX_API_KEY → MINIMAX_API_KEY
 * Base precedence: OD_MINIMAX_BASE_URL → MINIMAX_BASE_URL → default
 */
export function resolveMinimaxCredentials(
  env: NodeJS.ProcessEnv = process.env,
): MinimaxCredentials | null {
  const apiKey = (env.OD_MINIMAX_API_KEY || env.MINIMAX_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = (env.OD_MINIMAX_BASE_URL || env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  return { apiKey, baseUrl };
}

/**
 * Shared POST + decode for both MiniMax audio endpoints. Throws
 * HtmlVideoError('render-failed', …) on transport / API / decode failure.
 */
async function postAndDecode(
  endpoint: string,
  body: unknown,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; extraInfo: Record<string, unknown> }> {
  // MiniMax generation (esp. music) can take tens of seconds, but it must NOT
  // hang forever — an unbounded fetch leaves the studio's SSE stream stuck on
  // "generating…" with no failure event, which reads to the user as "the button
  // does nothing". Cap it; if the caller passed its own signal, respect that.
  const timeoutSignal = AbortSignal.timeout(MINIMAX_REQUEST_TIMEOUT_MS);
  const effectiveSignal = signal
    ? (AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal)
    : timeoutSignal;
  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError(
      'render-failed',
      isTimeout
        ? `minimax ${label} timed out after ${Math.round(MINIMAX_REQUEST_TIMEOUT_MS / 1000)}s (the API did not respond — try again, or check OD_MINIMAX_BASE_URL)`
        : `minimax ${label} request failed: ${msg} (check the API region — international is api.minimax.io, China is api.minimaxi.com; a key only works against its own region)`,
      true,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }

  let data: {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: unknown };
    extra_info?: Record<string, unknown>;
  };
  try {
    data = JSON.parse(respText);
  } catch {
    throw new HtmlVideoError('render-failed', `minimax ${label} non-JSON: ${truncate(respText, 200)}`);
  }

  // MiniMax wraps every response in base_resp; an HTTP 200 can still be a
  // logical failure (auth / params), surfaced via a non-zero status_code.
  if (data.base_resp && data.base_resp.status_code !== 0) {
    const code = data.base_resp.status_code;
    const hint = code === 1004 || code === 1008 ? ' (auth / insufficient balance — check the API key)' : '';
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} api error ${code}: ${data.base_resp.status_msg || 'unknown'}${hint}`,
    );
  }

  const hex = data.data?.audio;
  if (typeof hex !== 'string' || !hex) {
    throw new HtmlVideoError('render-failed', `minimax ${label} response missing data.audio`);
  }
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', `minimax ${label} decoded zero bytes`);
  }
  return { bytes, extraInfo: data.extra_info ?? {} };
}

/**
 * Generate spoken narration via MiniMax TTS (`/t2a_v2`).
 * Defaults to a neutral Mandarin male voice that reads both zh + en well.
 */
export async function generateTts(opts: {
  text: string;
  voiceId?: string;
  languageBoost?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  creds: MinimaxCredentials;
  signal?: AbortSignal;
}): Promise<MinimaxAudioResult> {
  const text = (opts.text || '').trim();
  if (!text) {
    throw new HtmlVideoError('invalid-input', 'narration text is empty');
  }
  const voiceId = (opts.voiceId || '').trim() || 'male-qn-qingse';
  const languageBoost = (opts.languageBoost || '').trim();

  const body = {
    model: MINIMAX_TTS_MODEL,
    text,
    stream: false,
    ...(languageBoost ? { language_boost: languageBoost } : {}),
    voice_setting: {
      voice_id: voiceId,
      speed: opts.speed ?? 1.0,
      vol: opts.vol ?? 1.0,
      pitch: opts.pitch ?? 0,
    },
    audio_setting: { sample_rate: 32000, format: 'mp3' },
  };

  const { bytes, extraInfo } = await postAndDecode('t2a_v2', body, opts.creds, 'tts', opts.signal);
  const audioLen = typeof extraInfo.audio_length === 'number' ? extraInfo.audio_length : undefined;
  const durationSec = audioLen ? Math.round(audioLen / 100) / 10 : undefined;
  return {
    bytes,
    ext: '.mp3',
    providerNote: `minimax/${MINIMAX_TTS_MODEL} · ${voiceId} · ${durationSec ?? '?'}s · ${bytes.length} bytes`,
    durationSec,
  };
}

/**
 * Generate background music via MiniMax (`/music_generation`).
 * Instrumental-only by default (a video soundtrack rarely wants vocals).
 */
export async function generateMusic(opts: {
  prompt: string;
  instrumental?: boolean;
  creds: MinimaxCredentials;
  signal?: AbortSignal;
}): Promise<MinimaxAudioResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) {
    throw new HtmlVideoError('invalid-input', 'music prompt is empty');
  }

  const instrumental = opts.instrumental ?? true;
  // music-1.5 requires a non-empty `lyrics` field and has no is_instrumental
  // flag. For an instrumental soundtrack we feed a minimal hummed placeholder
  // so the model produces a melody without foregrounded vocals; otherwise let
  // the prompt double as a loose lyrical brief.
  const lyrics = instrumental ? '[Intro]\nooh ooh\n[Hook]\nla la la' : prompt;
  const body = {
    model: MINIMAX_MUSIC_MODEL,
    prompt,
    lyrics,
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
    output_format: 'hex',
  };

  const { bytes } = await postAndDecode('music_generation', body, opts.creds, 'music', opts.signal);
  return {
    bytes,
    ext: '.mp3',
    providerNote: `minimax/${MINIMAX_MUSIC_MODEL} · ${instrumental ? 'instrumental' : 'with-vocals'} · ${bytes.length} bytes`,
  };
}

/**
 * Generate a short target video via MiniMax video_generation.
 *
 * The API is asynchronous: submit prompt → poll query/video_generation until a
 * file id is ready → download the MP4 via files/retrieve. The endpoint names and
 * bearer auth intentionally mirror MiniMax's published video provider pattern,
 * while `creds.baseUrl` keeps the existing regional host override behavior
 * (`api.minimax.io/v1` or `api.minimaxi.com/v1`).
 */
export async function generateVideo(opts: {
  prompt: string;
  model?: string;
  creds: MinimaxCredentials;
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<MinimaxVideoResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) {
    throw new HtmlVideoError('invalid-input', 'video prompt is empty');
  }

  const model = (opts.model || '').trim() || 'MiniMax-M3';
  const submit = await postJson<{ task_id?: unknown }>(
    'video_generation',
    { model, prompt },
    opts.creds,
    'video',
    opts.signal,
  );
  const taskId = asNonEmptyString(submit.task_id, 'minimax video response missing task_id');
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let fileId = '';
  let lastStatus = '';

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new HtmlVideoError('render-failed', 'minimax video generation aborted', true);
    }
    await delay(pollIntervalMs, opts.signal);
    const query = await getJson<{
      status?: unknown;
      file_id?: unknown;
      video_url?: unknown;
      base_resp?: { status_code?: number; status_msg?: string };
    }>(`query/video_generation?task_id=${encodeURIComponent(taskId)}`, opts.creds, 'video query', opts.signal);
    lastStatus = typeof query.status === 'string' ? query.status : lastStatus;
    if (query.base_resp && query.base_resp.status_code !== 0) {
      throw new HtmlVideoError(
        'render-failed',
        `minimax video query api error ${query.base_resp.status_code}: ${query.base_resp.status_msg || 'unknown'}`,
      );
    }
    fileId = typeof query.file_id === 'string' ? query.file_id : '';
    const videoUrl = typeof query.video_url === 'string' ? query.video_url : '';
    if (fileId || videoUrl) {
      const bytes = fileId
        ? await downloadMinimaxFile(fileId, opts.creds, opts.signal)
        : await downloadUrl(videoUrl, opts.signal);
      return {
        bytes,
        ext: '.mp4',
        providerNote: `minimax/${model} · video · ${bytes.length} bytes`,
        taskId,
        ...(fileId ? { fileId } : {}),
      };
    }
    if (lastStatus && /fail|error|reject/i.test(lastStatus)) {
      throw new HtmlVideoError('render-failed', `minimax video generation failed: ${lastStatus}`);
    }
  }

  throw new HtmlVideoError(
    'render-failed',
    `minimax video timed out after ${Math.round(timeoutMs / 1000)}s${lastStatus ? ` (last status: ${lastStatus})` : ''}`,
    true,
  );
}

async function postJson<T>(
  endpoint: string,
  body: unknown,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `minimax ${label} request failed: ${msg}`, true);
  }
  return parseJsonResponse<T>(resp, label);
}

async function getJson<T>(
  endpoint: string,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/${endpoint}`, {
      headers: { authorization: `Bearer ${creds.apiKey}` },
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `minimax ${label} request failed: ${msg}`, true);
  }
  return parseJsonResponse<T>(resp, label);
}

async function parseJsonResponse<T>(resp: Response, label: string): Promise<T> {
  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError('render-failed', `minimax ${label} ${resp.status}: ${truncate(respText, 240)}`, resp.status >= 500);
  }
  try {
    return JSON.parse(respText) as T;
  } catch {
    throw new HtmlVideoError('render-failed', `minimax ${label} non-JSON: ${truncate(respText, 200)}`);
  }
}

async function downloadMinimaxFile(fileId: string, creds: MinimaxCredentials, signal?: AbortSignal): Promise<Buffer> {
  const meta = await getJson<{ file?: { download_url?: unknown }; download_url?: unknown }>(
    `files/retrieve?file_id=${encodeURIComponent(fileId)}`,
    creds,
    'video file',
    signal,
  );
  const url = typeof meta.file?.download_url === 'string'
    ? meta.file.download_url
    : typeof meta.download_url === 'string'
      ? meta.download_url
      : '';
  if (!url) {
    throw new HtmlVideoError('render-failed', 'minimax video file response missing download_url');
  }
  return downloadUrl(url, signal);
}

async function downloadUrl(url: string, signal?: AbortSignal): Promise<Buffer> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `minimax video download failed: ${msg}`, true);
  }
  if (!resp.ok) {
    throw new HtmlVideoError('render-failed', `minimax video download ${resp.status}`, resp.status >= 500);
  }
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', 'minimax video download returned zero bytes');
  }
  return bytes;
}

function asNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HtmlVideoError('render-failed', message);
  }
  return value.trim();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new HtmlVideoError('render-failed', 'minimax video generation aborted', true));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new HtmlVideoError('render-failed', 'minimax video generation aborted', true));
    }, { once: true });
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
