import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateVideo } from '../dist/minimax.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('generateVideo submits, polls, and downloads through the configured API base URL', async () => {
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
        status: 'Success',
        file_id: 'file-456',
        base_resp: { status_code: 0, status_msg: 'success' },
      });
    }
    if (calls.length === 3) {
      return Response.json({
        file: { download_url: 'https://cdn.example.test/generated.mp4' },
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
      'https://api.minimax.io/v1/video_generation',
      'https://api.minimax.io/v1/query/video_generation?task_id=task-123',
      'https://api.minimax.io/v1/files/retrieve?file_id=file-456',
      'https://cdn.example.test/generated.mp4',
    ],
  );
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer test-key');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: 'MiniMax-Hailuo-2.3',
    prompt: 'A slow tracking shot through a bright studio.',
  });
  assert.deepEqual(result.bytes, Buffer.from([0, 0, 0, 24]));
  assert.equal(result.taskId, 'task-123');
  assert.equal(result.fileId, 'file-456');
  assert.equal(result.ext, '.mp4');
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
          status: 'Fail',
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
