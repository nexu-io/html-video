import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateVideo } from '../dist/minimax.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('generateVideo submits, polls, and downloads through the v2 API base URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });

    if (calls.length === 1) {
      return Response.json({
        task_id: 'task-123',
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }
    if (calls.length === 2) {
      return Response.json({
        task: {
          id: 'task-123',
          status: 'success',
          content: { url: 'https://cdn.example.test/generated.mp4' },
          resolution: '2K',
          duration: 6,
        },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }
    return new Response(Uint8Array.from([0, 0, 0, 24]), { status: 200 });
  };

  const result = await generateVideo({
    prompt: 'A slow tracking shot through a bright studio.',
    creds: { apiKey: 'test-key', baseUrl: 'https://api.minimax.io/v1' },
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://api.minimax.io/v2/video_generation',
      'https://api.minimax.io/v2/query/video_generation/task-123',
      'https://cdn.example.test/generated.mp4',
    ],
  );
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer test-key');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: 'MiniMax-H3',
    content: [{ type: 'text', text: 'A slow tracking shot through a bright studio.' }],
    resolution: '2K',
    duration: 6,
    ratio: 'adaptive',
  });
  assert.deepEqual(result.bytes, Buffer.from([0, 0, 0, 24]));
  assert.equal(result.taskId, 'task-123');
  assert.equal(result.url, 'https://cdn.example.test/generated.mp4');
  assert.equal(result.ext, '.mp4');
});

test('generateVideo maps a configured China v1 base URL to the matching v2 endpoint', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (calls.length === 1) {
      return Response.json({
        task_id: 'task-cn',
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }
    if (calls.length === 2) {
      return Response.json({
        task: {
          id: 'task-cn',
          status: 'completed',
          content: { url: 'https://cdn.example.test/cn.mp4' },
        },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }
    return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
  };

  await generateVideo({
    prompt: 'A short studio clip.',
    creds: { apiKey: 'test-key', baseUrl: 'https://api.minimaxi.com/v1' },
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  assert.deepEqual(calls.slice(0, 2), [
    'https://api.minimaxi.com/v2/video_generation',
    'https://api.minimaxi.com/v2/query/video_generation/task-cn',
  ]);
});

test('generateVideo stops when the provider reports a failed task', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return callCount === 1
      ? Response.json({
          task_id: 'task-failed',
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      : Response.json({
          task: { id: 'task-failed', status: 'failed', error: 'invalid prompt' },
          base_resp: { status_code: 0, status_msg: 'success' },
        });
  };

  await assert.rejects(
    generateVideo({
      prompt: 'A short studio clip.',
      creds: { apiKey: 'test-key', baseUrl: 'https://api.minimax.io/v1' },
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    }),
    /minimax video generation failed/,
  );
  assert.equal(callCount, 2);
});
