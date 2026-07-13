/**
 * @html-video/core - MiniMax media provider.
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
/** Current text-to-video model used by the official video generation guide. */
const MINIMAX_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';
const MINIMAX_VIDEO_POLL_INTERVAL_MS = 10_000;
const MINIMAX_VIDEO_TIMEOUT_MS = 10 * 60_000;

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
  /** Downloaded video bytes (MP4). */
  bytes: Buffer;
  /** File extension to store under. */
  ext: '.mp4';
  /** Human-readable note of what was produced (provider, model, and size). */
  providerNote: string;
  /** Provider task id, useful for support and debugging. */
  taskId: string;
  /** Provider file id returned when generation succeeds. */
  fileId: string;
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
 * Generate a video through MiniMax's asynchronous text-to-video API.
 *
 * The provider returns a task id first. Polling yields a file id after the task
 * succeeds, then the file API provides a short-lived MP4 download URL.
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
  if (prompt.length > 2000) {
    throw new HtmlVideoError('invalid-input', 'video prompt exceeds 2000 characters');
  }

  const pollIntervalMs = opts.pollIntervalMs ?? MINIMAX_VIDEO_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? MINIMAX_VIDEO_TIMEOUT_MS;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new HtmlVideoError('invalid-input', 'video poll interval must be non-negative');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new HtmlVideoError('invalid-input', 'video timeout must be positive');
  }

  const model = (opts.model || '').trim() || MINIMAX_VIDEO_MODEL;
  const submit = await requestMinimaxJson<{ task_id?: unknown; base_resp?: MinimaxBaseResponse }>(
    'video_generation',
    'POST',
    { model, prompt },
    opts.creds,
    'video creation',
    opts.signal,
  );
  const taskId = requireString(submit.task_id, 'minimax video response missing task_id');
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), opts.signal);
    const query = await requestMinimaxJson<{
      status?: unknown;
      file_id?: unknown;
      base_resp?: MinimaxBaseResponse;
    }>(
      `query/video_generation?task_id=${encodeURIComponent(taskId)}`,
      'GET',
      undefined,
      opts.creds,
      'video status',
      opts.signal,
    );
    lastStatus = requireString(query.status, 'minimax video status response missing status');

    if (lastStatus === 'Fail') {
      throw new HtmlVideoError('render-failed', 'minimax video generation failed');
    }
    if (lastStatus !== 'Success') continue;

    const fileId = requireString(
      query.file_id,
      'minimax video status response missing file_id after success',
    );
    const file = await requestMinimaxJson<{
      file?: { download_url?: unknown };
      base_resp?: MinimaxBaseResponse;
    }>(
      `files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      'GET',
      undefined,
      opts.creds,
      'video file',
      opts.signal,
    );
    const downloadUrl = requireString(
      file.file?.download_url,
      'minimax video file response missing download_url',
    );
    const bytes = await downloadVideo(downloadUrl, opts.signal);
    return {
      bytes,
      ext: '.mp4',
      providerNote: `minimax/${model} - video - ${bytes.length} bytes`,
      taskId,
      fileId,
    };
  }

  throw new HtmlVideoError(
    'render-failed',
    `minimax video timed out after ${Math.round(timeoutMs / 1000)}s${lastStatus ? ` (last status: ${lastStatus})` : ''}`,
    true,
  );
}

interface MinimaxBaseResponse {
  status_code?: number;
  status_msg?: string;
}

async function requestMinimaxJson<T extends { base_resp?: MinimaxBaseResponse }>(
  endpoint: string,
  method: 'GET' | 'POST',
  body: unknown,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/${endpoint}`, {
      method,
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: requestSignal(signal),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `minimax ${label} request failed: ${msg}`, true);
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }

  let data: T;
  try {
    data = JSON.parse(respText) as T;
  } catch {
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} non-JSON: ${truncate(respText, 200)}`,
    );
  }
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new HtmlVideoError(
      'render-failed',
      `minimax ${label} api error ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown'}`,
    );
  }
  return data;
}

async function downloadVideo(url: string, signal?: AbortSignal): Promise<Buffer> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal: requestSignal(signal) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `minimax video download failed: ${msg}`, true);
  }
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `minimax video download ${resp.status}`,
      resp.status >= 500,
    );
  }
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', 'minimax video download returned zero bytes');
  }
  return bytes;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(MINIMAX_REQUEST_TIMEOUT_MS);
  return signal && AbortSignal.any
    ? AbortSignal.any([signal, timeoutSignal])
    : (signal ?? timeoutSignal);
}

function requireString(value: unknown, message: string): string {
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

    const onAbort = () => {
      clearTimeout(timer);
      reject(new HtmlVideoError('render-failed', 'minimax video generation aborted', true));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
