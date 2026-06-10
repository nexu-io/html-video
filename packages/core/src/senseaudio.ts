/**
 * @html-video/core — SenseAudio (商汤 senseaudio.cn) TTS provider.
 *
 * SenseAudio's synthesis API is byte-for-byte compatible with MiniMax's:
 *   POST {baseUrl}/t2a_v2  · Authorization: Bearer  · same voice_setting /
 *   audio_setting body · response = `base_resp` envelope + hex `data.audio`.
 * So narration reuses the shared transport in `audio-http.ts`; only the default
 * base URL (`api.senseaudio.cn/v1`) and model (`senseaudio-tts-1.5-260319`)
 * differ. SenseAudio has NO music endpoint — background music stays MiniMax.
 *
 * Unlike MiniMax, SenseAudio voices are queryable at runtime via `/get_voice`,
 * so {@link listSenseAudioVoices} lets the studio populate a live voice picker.
 *
 * Docs: https://docs.senseaudio.cn/guides/tts/overview
 */

import { HtmlVideoError } from './errors.js';
import {
  postAudioAndDecode,
  postBearerJson,
  type BearerAudioCredentials,
  type GeneratedAudio,
} from './audio-http.js';

/** Default base URL (the only public region today). Override via SENSEAUDIO_BASE_URL. */
const SENSEAUDIO_DEFAULT_BASE_URL = 'https://api.senseaudio.cn/v1';
/** Default speech model — the expressive 1.5 tier the docs recommend. */
const SENSEAUDIO_DEFAULT_MODEL = 'senseaudio-tts-1.5-260319';
/** Neutral default voice ("自然少女 / Natural Girl") so narration works without a pick. */
const SENSEAUDIO_DEFAULT_VOICE = 'female_0037_a';

export type SenseAudioCredentials = BearerAudioCredentials;

export interface SenseAudioVoice {
  voiceId: string;
  name: string;
  description?: string[];
  /** Which bucket the API returned it in. */
  kind: 'system' | 'cloning' | 'generation';
}

/**
 * Resolve SenseAudio credentials from the environment. Returns `null` (not
 * throw) when no key is set, so callers can show a "configure your key" message.
 *
 * Key precedence:  SENSEAUDIO_API_KEY
 * Base precedence: SENSEAUDIO_BASE_URL → default
 */
export function resolveSenseAudioCredentials(
  env: NodeJS.ProcessEnv = process.env,
): SenseAudioCredentials | null {
  const apiKey = (env.SENSEAUDIO_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = (env.SENSEAUDIO_BASE_URL || SENSEAUDIO_DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  return { apiKey, baseUrl };
}

/**
 * Generate spoken narration via SenseAudio TTS (`/t2a_v2`).
 * Defaults to the neutral "自然少女" voice when none is given.
 */
export async function generateTtsSenseAudio(opts: {
  text: string;
  voiceId?: string;
  model?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  creds: SenseAudioCredentials;
  signal?: AbortSignal;
}): Promise<GeneratedAudio> {
  const text = (opts.text || '').trim();
  if (!text) {
    throw new HtmlVideoError('invalid-input', 'narration text is empty');
  }
  const model = (opts.model || '').trim() || SENSEAUDIO_DEFAULT_MODEL;
  const voiceId = (opts.voiceId || '').trim() || SENSEAUDIO_DEFAULT_VOICE;

  const body = {
    model,
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId,
      speed: opts.speed ?? 1.0,
      vol: opts.vol ?? 1.0,
      pitch: opts.pitch ?? 0,
    },
    audio_setting: { sample_rate: 32000, format: 'mp3' },
  };

  const { bytes, extraInfo } = await postAudioAndDecode({
    provider: 'senseaudio',
    endpoint: 't2a_v2',
    body,
    creds: opts.creds,
    label: 'tts',
    signal: opts.signal,
    hints: {
      transport: ' (check SENSEAUDIO_BASE_URL — the default region is api.senseaudio.cn)',
      status: (code) =>
        code === 1004 || code === 1008 ? ' (auth / insufficient balance — check the API key)' : '',
    },
  });

  const audioLen = typeof extraInfo.audio_length === 'number' ? extraInfo.audio_length : undefined;
  const durationSec = audioLen ? Math.round(audioLen / 100) / 10 : undefined;
  return {
    bytes,
    ext: '.mp3',
    providerNote: `senseaudio/${model} · ${voiceId} · ${durationSec ?? '?'}s · ${bytes.length} bytes`,
    durationSec,
  };
}

/**
 * List the voices available to this key via SenseAudio's `/get_voice`.
 * Returns system + cloned + generated voices flattened, tagged by `kind`.
 */
export async function listSenseAudioVoices(opts: {
  creds: SenseAudioCredentials;
  signal?: AbortSignal;
}): Promise<SenseAudioVoice[]> {
  const data = await postBearerJson<{
    system_voice?: RawVoice[];
    voice_cloning?: RawVoice[];
    voice_generation?: RawVoice[];
  }>({
    provider: 'senseaudio',
    endpoint: 'get_voice',
    body: { voice_type: 'all' },
    creds: opts.creds,
    label: 'voices',
    signal: opts.signal,
  });

  const out: SenseAudioVoice[] = [];
  const push = (arr: RawVoice[] | undefined, kind: SenseAudioVoice['kind']) => {
    for (const v of arr ?? []) {
      if (!v || typeof v.voice_id !== 'string' || !v.voice_id) continue;
      out.push({
        voiceId: v.voice_id,
        name: typeof v.voice_name === 'string' && v.voice_name ? v.voice_name : v.voice_id,
        description: Array.isArray(v.description) ? v.description : undefined,
        kind,
      });
    }
  };
  push(data.system_voice, 'system');
  push(data.voice_cloning, 'cloning');
  push(data.voice_generation, 'generation');
  return out;
}

interface RawVoice {
  voice_id?: unknown;
  voice_name?: unknown;
  description?: unknown;
}
