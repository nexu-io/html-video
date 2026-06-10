/**
 * @html-video/core — shared Bearer-audio HTTP transport.
 *
 * MiniMax and SenseAudio expose byte-for-byte compatible TTS APIs: same
 * `/t2a_v2` path, same `Authorization: Bearer` auth, the same
 * `voice_setting` / `audio_setting` request shape, and the same response —
 * a `base_resp` envelope plus the audio as a hex string in `data.audio`.
 *
 * Rather than duplicate the fetch → status-check → hex-decode dance per
 * provider, both `minimax.ts` and `senseaudio.ts` call {@link postAudioAndDecode}.
 * Provider-specific error wording is injected via {@link AudioHttpHints} so the
 * shared transport stays generic while each provider keeps accurate hints
 * (MiniMax's region-bound keys, SenseAudio's single endpoint, etc).
 */

import { HtmlVideoError } from './errors.js';

/** Bearer-authenticated audio endpoint credentials (key + region base URL). */
export interface BearerAudioCredentials {
  apiKey: string;
  baseUrl: string;
}

/** Decoded audio + the provider note callers surface to the user. */
export interface GeneratedAudio {
  /** Decoded audio bytes (MP3). */
  bytes: Buffer;
  /** File extension to store under. */
  ext: '.mp3';
  /** Human-readable note of what was produced (provider · model · size). */
  providerNote: string;
  /** Reported duration in seconds, if the API surfaced it. */
  durationSec?: number;
}

/** Provider-specific suffixes appended to the shared error messages. */
export interface AudioHttpHints {
  /** Appended to a transport (network) failure message. */
  transport?: string;
  /** Maps an API `base_resp.status_code` to an extra hint suffix. */
  status?: (code: number) => string;
}

/** Hard ceiling for a single audio request — a request that hasn't returned in
 *  2 minutes is hung, not slow (music generation is the slow case). */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * POST a JSON body to a Bearer audio endpoint and decode the hex `data.audio`.
 * Throws HtmlVideoError('render-failed', …) on transport / API / decode failure.
 */
export async function postAudioAndDecode(opts: {
  provider: string;
  endpoint: string;
  body: unknown;
  creds: BearerAudioCredentials;
  label: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  hints?: AudioHttpHints;
}): Promise<{ bytes: Buffer; extraInfo: Record<string, unknown> }> {
  const { provider, endpoint, body, creds, label, signal, hints } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // Generation can take tens of seconds, but must NOT hang forever — an
  // unbounded fetch leaves the studio's SSE stream stuck on "generating…" with
  // no failure event. Cap it; if the caller passed its own signal, respect both.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
        ? `${provider} ${label} timed out after ${Math.round(timeoutMs / 1000)}s (the API did not respond — try again, or check the base URL)`
        : `${provider} ${label} request failed: ${msg}${hints?.transport ?? ''}`,
      true,
    );
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `${provider} ${label} ${resp.status}: ${truncate(respText, 240)}`,
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
    throw new HtmlVideoError('render-failed', `${provider} ${label} non-JSON: ${truncate(respText, 200)}`);
  }

  // Both providers wrap every response in base_resp; an HTTP 200 can still be a
  // logical failure (auth / params), surfaced via a non-zero status_code.
  if (data.base_resp && data.base_resp.status_code !== 0) {
    const code = data.base_resp.status_code ?? -1;
    const hint = hints?.status?.(code) ?? '';
    throw new HtmlVideoError(
      'render-failed',
      `${provider} ${label} api error ${code}: ${data.base_resp.status_msg || 'unknown'}${hint}`,
    );
  }

  const hex = data.data?.audio;
  if (typeof hex !== 'string' || !hex) {
    throw new HtmlVideoError('render-failed', `${provider} ${label} response missing data.audio`);
  }
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', `${provider} ${label} decoded zero bytes`);
  }
  return { bytes, extraInfo: data.extra_info ?? {} };
}

/**
 * POST a JSON body to a Bearer endpoint and return the parsed JSON (no audio
 * decode). Used for metadata calls like SenseAudio's `/get_voice`. Throws on
 * transport / non-200 / non-JSON / non-zero `base_resp.status_code`.
 */
export async function postBearerJson<T = unknown>(opts: {
  provider: string;
  endpoint: string;
  body: unknown;
  creds: BearerAudioCredentials;
  label: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  const { provider, endpoint, body, creds, label, signal } = opts;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `${provider} ${label} request failed: ${msg}`, true);
  }

  const respText = await resp.text();
  if (!resp.ok) {
    throw new HtmlVideoError(
      'render-failed',
      `${provider} ${label} ${resp.status}: ${truncate(respText, 240)}`,
      resp.status >= 500,
    );
  }
  let data: { base_resp?: { status_code?: number; status_msg?: string } } & Record<string, unknown>;
  try {
    data = JSON.parse(respText);
  } catch {
    throw new HtmlVideoError('render-failed', `${provider} ${label} non-JSON: ${truncate(respText, 200)}`);
  }
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new HtmlVideoError(
      'render-failed',
      `${provider} ${label} api error ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown'}`,
    );
  }
  return data as T;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
