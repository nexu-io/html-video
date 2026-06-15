/**
 * @html-video/core — FishAudio TTS provider (narration only).
 *
 * FishAudio (https://fish.audio) is a second narration backend alongside
 * {@link ./minimax.ts}. Unlike MiniMax it does NOT generate music, so this
 * module only exposes speech synthesis + a voice-listing helper.
 *
 * Shape differences from MiniMax that this module absorbs:
 *   - the model is selected via an HTTP `model` header (s1 / s2-pro), not a
 *     body field, and is configured through the environment (FISH_AUDIO_MODEL);
 *   - `/v1/tts` returns the audio as a RAW binary body — no JSON envelope, no
 *     hex string to decode (MiniMax wraps it in `base_resp` + hex);
 *   - errors are surfaced as ordinary HTTP status codes (401/402/422);
 *   - a single global host (no international/China region split).
 *
 * Credentials are read from the environment so the studio works without a
 * config file; a missing key yields `null` from
 * {@link resolveFishAudioCredentials} and callers report it gracefully.
 */

import { HtmlVideoError } from './errors.js';
import type { TtsAudioResult } from './types/index.js';

/** Default host. FishAudio is a single global endpoint (no region split). We
 *  store the host only and append `/v1/tts` and `/model`; override via
 *  FISH_AUDIO_BASE_URL (or the Studio Settings UI). */
const FISH_DEFAULT_BASE_URL = 'https://api.fish.audio';
/** Default speech model. `s1` is the fast general model; `s2-pro` adds
 *  multi-speaker. Selected via the `model` header, configured by env. */
const FISH_DEFAULT_MODEL = 's1';
/** Hard ceiling for a single TTS request — a request that hasn't returned in
 *  2 minutes is hung, not slow. */
const FISH_REQUEST_TIMEOUT_MS = 120_000;

export interface FishAudioCredentials {
  apiKey: string;
  baseUrl: string;
  /** Speech model sent in the `model` header (e.g. 's1' or 's2-pro'). */
  model: string;
}

/**
 * Resolve FishAudio credentials from the environment. Returns `null` (not
 * throw) when no key is set, so the studio can show a friendly "configure your
 * key" message instead of a 500.
 *
 * Key precedence:   FISH_AUDIO_API_KEY → FISHAUDIO_API_KEY
 * Base precedence:  FISH_AUDIO_BASE_URL → default
 * Model precedence: FISH_AUDIO_MODEL → default (s1)
 */
export function resolveFishAudioCredentials(
  env: NodeJS.ProcessEnv = process.env,
): FishAudioCredentials | null {
  const apiKey = (env.FISH_AUDIO_API_KEY || env.FISHAUDIO_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = (env.FISH_AUDIO_BASE_URL || FISH_DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  const model = (env.FISH_AUDIO_MODEL || FISH_DEFAULT_MODEL).trim();
  return { apiKey, baseUrl, model };
}

/**
 * Synthesize spoken narration via FishAudio TTS (`POST /v1/tts`).
 *
 * The model is sent in the `model` header (from creds.model). The response is
 * a RAW binary audio body — no JSON envelope — so we read `arrayBuffer()`
 * directly. A missing `referenceId` falls back to FishAudio's default voice.
 */
export async function generateFishTts(opts: {
  text: string;
  referenceId?: string;
  creds: FishAudioCredentials;
  signal?: AbortSignal;
}): Promise<TtsAudioResult> {
  const text = (opts.text || '').trim();
  if (!text) {
    throw new HtmlVideoError('invalid-input', 'narration text is empty');
  }
  const referenceId = (opts.referenceId || '').trim();
  const { creds } = opts;

  const body = {
    text,
    format: 'mp3',
    ...(referenceId ? { reference_id: referenceId } : {}),
  };

  const timeoutSignal = AbortSignal.timeout(FISH_REQUEST_TIMEOUT_MS);
  const effectiveSignal = opts.signal
    ? AbortSignal.any
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : opts.signal
    : timeoutSignal;

  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/v1/tts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
        // FishAudio selects the speech model via a header, not a body field.
        model: creds.model,
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
        ? `fishaudio tts timed out after ${Math.round(FISH_REQUEST_TIMEOUT_MS / 1000)}s (the API did not respond — try again, or check FISH_AUDIO_BASE_URL)`
        : `fishaudio tts request failed: ${msg}`,
      true,
    );
  }

  if (!resp.ok) {
    const detail = truncate(await resp.text().catch(() => ''), 200);
    const hint =
      resp.status === 401
        ? ' (auth — check the FishAudio API key)'
        : resp.status === 402
          ? ' (no credit — check the account balance)'
          : '';
    throw new HtmlVideoError(
      'render-failed',
      `fishaudio tts ${resp.status}: ${detail || 'request rejected'}${hint}`,
      resp.status >= 500,
    );
  }

  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length === 0) {
    throw new HtmlVideoError('render-failed', 'fishaudio tts returned zero audio bytes');
  }
  return {
    bytes,
    ext: '.mp3',
    providerNote: `fishaudio/${creds.model} · ${referenceId || 'default'} · ${bytes.length} bytes`,
  };
}

/** A trimmed FishAudio voice model, for the studio's voice picker. */
export interface FishVoice {
  /** The model id — passed back as `reference_id` when synthesizing. */
  id: string;
  title: string;
  languages: string[];
  /** Preview audio URL (first sample), if the model has one. */
  sampleUrl?: string;
}

/**
 * List the account's own voice models via `GET /model?self=true`, optionally
 * filtered by a title query. Returns a trimmed shape for the picker; the raw
 * FishAudio model objects carry far more than the UI needs.
 */
export async function listFishVoices(opts: {
  creds: FishAudioCredentials;
  query?: string;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<FishVoice[]> {
  const { creds } = opts;
  const params = new URLSearchParams({ self: 'true', page_size: String(opts.pageSize ?? 20) });
  const query = (opts.query || '').trim();
  if (query) params.set('title', query);

  let resp: Response;
  try {
    resp = await fetch(`${creds.baseUrl}/model?${params.toString()}`, {
      headers: { authorization: `Bearer ${creds.apiKey}` },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HtmlVideoError('render-failed', `fishaudio list voices request failed: ${msg}`, true);
  }
  if (!resp.ok) {
    const detail = truncate(await resp.text().catch(() => ''), 200);
    throw new HtmlVideoError(
      'render-failed',
      `fishaudio list voices ${resp.status}: ${detail || 'request rejected'}`,
      resp.status >= 500,
    );
  }

  const data = (await resp.json().catch(() => ({}))) as {
    items?: Array<{
      _id?: string;
      title?: string;
      languages?: string[];
      samples?: Array<{ audio?: string }>;
    }>;
  };
  return (data.items ?? [])
    .filter((m): m is { _id: string } & typeof m => typeof m._id === 'string' && m._id.length > 0)
    .map((m) => {
      const sampleUrl = m.samples?.find((s) => typeof s.audio === 'string')?.audio;
      return {
        id: m._id,
        title: (m.title || '').trim() || m._id,
        languages: Array.isArray(m.languages) ? m.languages : [],
        ...(sampleUrl ? { sampleUrl } : {}),
      };
    });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
