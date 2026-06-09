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
 * That transport now lives in `audio-http.ts` and is shared with the
 * wire-compatible SenseAudio provider; this module keeps the MiniMax-specific
 * defaults (models, region hints) and the music endpoint MiniMax alone exposes.
 *
 * Credentials are read from the environment so the studio works without any
 * config file; a missing key yields `null` from {@link resolveMinimaxCredentials}
 * and callers report it gracefully instead of throwing.
 */

import { HtmlVideoError } from './errors.js';
import { postAudioAndDecode, type GeneratedAudio } from './audio-http.js';

/** Default base URL. The old `api.minimaxi.chat` host is RETIRED server-side
 *  (issue #4). MiniMax now has two region-bound endpoints — international
 *  `api.minimax.io` and China `api.minimaxi.com` — and a key only authenticates
 *  against its own region. We default to international; override via
 *  OD_MINIMAX_BASE_URL / MINIMAX_BASE_URL (or the Studio Settings UI). */
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

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

/** Re-exported under the historical name; the shape is provider-neutral now. */
export type MinimaxAudioResult = GeneratedAudio;

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
 * Shared POST + decode for both MiniMax audio endpoints, delegating to the
 * generic Bearer-audio transport but carrying MiniMax's region/balance hints.
 */
function postAndDecode(
  endpoint: string,
  body: unknown,
  creds: MinimaxCredentials,
  label: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; extraInfo: Record<string, unknown> }> {
  return postAudioAndDecode({
    provider: 'minimax',
    endpoint,
    body,
    creds,
    label,
    signal,
    hints: {
      transport:
        ' (check the API region — international is api.minimax.io, China is api.minimaxi.com; a key only works against its own region)',
      status: (code) =>
        code === 1004 || code === 1008 ? ' (auth / insufficient balance — check the API key)' : '',
    },
  });
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
