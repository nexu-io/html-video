import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFishAudioCredentials, generateFishTts, listFishVoices } from '../dist/fishaudio.js';
import { HtmlVideoError } from '../dist/errors.js';

const CREDS = { apiKey: 'k-secret', baseUrl: 'https://api.fish.audio', model: 's1' };

/** Swap in a stubbed global fetch for the duration of `fn`, recording the
 *  single request it receives. Restores the real fetch afterwards. */
async function withFetch(
  responder: (url: string, init: RequestInit) => Response,
  fn: (calls: { url: string; init: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }) as unknown as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const okAudio = () =>
  new Response(new Uint8Array([0xff, 0xfb, 0x10, 0x20]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });

// resolveFishAudioCredentials mirrors resolveMinimaxCredentials: it reads creds
// from the environment, returns null (never throws) when no key is set, and
// applies env precedence + defaults. FishAudio has a single global host (no
// region split) and selects the model via env (FISH_AUDIO_MODEL).

test('returns null when no key is set', () => {
  assert.equal(resolveFishAudioCredentials({}), null);
});

test('FISH_AUDIO_API_KEY yields default host + default model s1', () => {
  const c = resolveFishAudioCredentials({ FISH_AUDIO_API_KEY: 'k-123' });
  assert.deepEqual(c, { apiKey: 'k-123', baseUrl: 'https://api.fish.audio', model: 's1' });
});

test('FISHAUDIO_API_KEY is accepted as a fallback key name', () => {
  const c = resolveFishAudioCredentials({ FISHAUDIO_API_KEY: 'k-fallback' });
  assert.equal(c?.apiKey, 'k-fallback');
});

test('FISH_AUDIO_API_KEY takes precedence over FISHAUDIO_API_KEY', () => {
  const c = resolveFishAudioCredentials({
    FISH_AUDIO_API_KEY: 'primary',
    FISHAUDIO_API_KEY: 'secondary',
  });
  assert.equal(c?.apiKey, 'primary');
});

test('FISH_AUDIO_BASE_URL overrides the default and strips a trailing slash', () => {
  const c = resolveFishAudioCredentials({
    FISH_AUDIO_API_KEY: 'k',
    FISH_AUDIO_BASE_URL: 'https://proxy.example.com/',
  });
  assert.equal(c?.baseUrl, 'https://proxy.example.com');
});

test('FISH_AUDIO_MODEL overrides the default model', () => {
  const c = resolveFishAudioCredentials({ FISH_AUDIO_API_KEY: 'k', FISH_AUDIO_MODEL: 's2-pro' });
  assert.equal(c?.model, 's2-pro');
});

test('a whitespace-only key is treated as unset', () => {
  assert.equal(resolveFishAudioCredentials({ FISH_AUDIO_API_KEY: '   ' }), null);
});

// --- generateFishTts -------------------------------------------------------

test('posts to /v1/tts with bearer auth, the model header, and the right body', async () => {
  await withFetch(okAudio, async (calls) => {
    const r = await generateFishTts({ text: 'hello world', referenceId: 'voice-42', creds: CREDS });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.fish.audio/v1/tts');
    const h = calls[0]!.init.headers as Record<string, string>;
    assert.equal(h.authorization, 'Bearer k-secret');
    assert.equal(h.model, 's1');
    assert.equal(h['content-type'], 'application/json');
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal(body.text, 'hello world');
    assert.equal(body.reference_id, 'voice-42');
    assert.equal(body.format, 'mp3');
    // decoded the raw binary body into bytes, tagged as mp3
    assert.ok(Buffer.isBuffer(r.bytes));
    assert.equal(r.bytes.length, 4);
    assert.equal(r.ext, '.mp3');
    assert.match(r.providerNote, /fishaudio\/s1/);
  });
});

test('omits reference_id from the body when no voice is given (default voice)', async () => {
  await withFetch(okAudio, async (calls) => {
    await generateFishTts({ text: 'no voice', creds: CREDS });
    const body = JSON.parse(calls[0]!.init.body as string);
    assert.equal('reference_id' in body, false);
  });
});

test('rejects empty text without hitting the network', async () => {
  await withFetch(okAudio, async (calls) => {
    await assert.rejects(
      () => generateFishTts({ text: '   ', creds: CREDS }),
      (e: unknown) => e instanceof HtmlVideoError && e.code === 'invalid-input',
    );
    assert.equal(calls.length, 0);
  });
});

test('maps HTTP 401 to a friendly auth error', async () => {
  const resp401 = () => new Response('unauthorized', { status: 401 });
  await withFetch(resp401, async () => {
    await assert.rejects(
      () => generateFishTts({ text: 'x', creds: CREDS }),
      (e: unknown) => e instanceof HtmlVideoError && /401|auth|key/i.test(e.message),
    );
  });
});

test('maps HTTP 402 to a friendly credit/balance error', async () => {
  const resp402 = () => new Response('payment required', { status: 402 });
  await withFetch(resp402, async () => {
    await assert.rejects(
      () => generateFishTts({ text: 'x', creds: CREDS }),
      (e: unknown) => e instanceof HtmlVideoError && /402|credit|balance/i.test(e.message),
    );
  });
});

test('rejects a zero-byte audio body', async () => {
  const empty = () =>
    new Response(new Uint8Array([]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  await withFetch(empty, async () => {
    await assert.rejects(
      () => generateFishTts({ text: 'x', creds: CREDS }),
      (e: unknown) => e instanceof HtmlVideoError,
    );
  });
});

// --- listFishVoices --------------------------------------------------------

const voicesBody = (items: unknown[]) =>
  new Response(JSON.stringify({ total: items.length, items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

test('lists own voices via GET /model with self=true + a title query, bearer auth', async () => {
  const responder = () =>
    voicesBody([
      {
        _id: 'v1',
        title: '平淡',
        languages: ['zh'],
        samples: [{ audio: 'https://cdn.fish.audio/v1.mp3' }],
      },
    ]);
  await withFetch(responder, async (calls) => {
    const voices = await listFishVoices({ creds: CREDS, query: '平淡' });
    const u = new URL(calls[0]!.url);
    assert.equal(u.origin + u.pathname, 'https://api.fish.audio/model');
    assert.equal(u.searchParams.get('self'), 'true');
    assert.equal(u.searchParams.get('title'), '平淡');
    const h = calls[0]!.init.headers as Record<string, string>;
    assert.equal(h.authorization, 'Bearer k-secret');
    assert.deepEqual(voices, [
      { id: 'v1', title: '平淡', languages: ['zh'], sampleUrl: 'https://cdn.fish.audio/v1.mp3' },
    ]);
  });
});

test('omits the title param when no query is given', async () => {
  await withFetch(
    () => voicesBody([]),
    async (calls) => {
      await listFishVoices({ creds: CREDS });
      const u = new URL(calls[0]!.url);
      assert.equal(u.searchParams.has('title'), false);
      assert.equal(u.searchParams.get('self'), 'true');
    },
  );
});

test('a voice with no samples yields an undefined sampleUrl', async () => {
  const responder = () => voicesBody([{ _id: 'v2', title: 'bare', languages: [], samples: [] }]);
  await withFetch(responder, async () => {
    const voices = await listFishVoices({ creds: CREDS });
    assert.equal(voices[0]!.sampleUrl, undefined);
  });
});
