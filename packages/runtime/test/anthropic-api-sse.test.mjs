import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicApi } from '../dist/index.js';

// Regression coverage for issue #95: the Anthropic HTTP agent used to report
// `{ exitCode: 0 }` for every HTTP-200 SSE response, even when the provider
// sent an `error` event, the body was empty, or the stream ended mid-message
// (EOF without `message_stop`). Broken output looked like a finished reply.
// The handler now tracks terminal state explicitly.

process.env.ANTHROPIC_API_KEY ||= 'synthetic-test-placeholder';
process.env.ANTHROPIC_BASE_URL ||= 'https://invalid.example';

const enc = new TextEncoder();
const streamOf = (text) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });

async function runHandler(sseBody) {
  const events = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(streamOf(sseBody), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  try {
    const result = await anthropicApi.httpHandler(
      'synthetic prompt',
      {},
      (e) => events.push(e),
      new AbortController().signal,
    );
    return { result, events };
  } finally {
    globalThis.fetch = prevFetch;
  }
}

const DELTA =
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<html>"}}\n\n';

test('happy path: delta + message_stop → exit 0, text emitted', async () => {
  const { result, events } = await runHandler(
    DELTA + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  );
  assert.equal(result.exitCode, 0);
  assert.equal(events.filter((e) => e.type === 'text').length, 1);
});

test('SSE error event → nonzero exit, error emitted (issue #95 fixture)', async () => {
  const { result, events } = await runHandler(
    'event: error\ndata: {"type":"error","error":{"message":"synthetic overload"}}\n\n',
  );
  assert.notEqual(result.exitCode, 0);
  const errs = events.filter((e) => e.type === 'error');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /synthetic overload/);
});

test('text delta then EOF without message_stop → nonzero exit (premature EOF fixture)', async () => {
  const { result, events } = await runHandler(DELTA);
  assert.notEqual(result.exitCode, 0);
  // partial text is kept for diagnosis…
  assert.equal(events.filter((e) => e.type === 'text').length, 1);
  // …but the incompleteness is reported
  assert.ok(events.some((e) => e.type === 'error' && /message_stop/.test(e.message)));
});

test('empty HTTP-200 SSE body → nonzero exit (empty-body fixture)', async () => {
  const { result } = await runHandler('');
  assert.notEqual(result.exitCode, 0);
});

test('error event typed only on the event: line is still recognised', async () => {
  const { result, events } = await runHandler(
    'event: error\ndata: {"error":{"message":"overloaded"}}\n\n',
  );
  assert.notEqual(result.exitCode, 0);
  assert.ok(events.some((e) => e.type === 'error' && /overloaded/.test(e.message)));
});
