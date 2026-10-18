import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { findAgent, spawnAgent } from '../dist/index.js';
import type { AgentEvent } from '../dist/index.js';

const ENDPOINT = 'https://search.parallel.ai/mcp';
const SOURCE = 'https://example.com/public-source';
const UA = 'html-video/0.1.0 (+https://github.com/nexu-io/html-video)';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
function stream(blocks: Block[], reason = 'end_turn', truncated = false) {
  const events: unknown[] = [];
  for (const [index, block] of blocks.entries()) {
    events.push({
      type: 'content_block_start',
      index,
      content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} },
    });
    if (block.type === 'text')
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    else {
      const json = JSON.stringify(block.input);
      for (const partial_json of [json.slice(0, 7), json.slice(7)]) {
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json },
        });
      }
    }
    events.push({ type: 'content_block_stop', index });
  }
  events.push({ type: 'message_delta', delta: { stop_reason: reason } });
  if (!truncated) events.push({ type: 'message_stop' });
  const bytes = new TextEncoder().encode(
    events.map((e) => `event: message\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''),
  );
  // Split CRLF, multibyte text and JSON across arbitrary network boundaries.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function fixture(
  t: TestContext,
  options: {
    disabled?: boolean;
    envDisabled?: boolean;
    apiKey?: string;
    failure?: 'http' | 'tool' | 'timeout' | 'cancel' | 'discovery';
    invalidUrl?: boolean;
    unknownTool?: boolean;
    repeat?: boolean;
    truncated?: boolean;
  } = {},
) {
  const env = { ...process.env };
  t.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
    Object.assign(process.env, env);
  });
  const setEnv = (key: string, value: string) => {
    process.env[key] = value;
  };
  for (const name of [
    'PARALLEL_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'HV_AGENT_MODEL',
    'HV_WEB_SEARCH',
    'HV_WEB_SEARCH_TIMEOUT_MS',
  ]) {
    setEnv(name, '');
  }
  setEnv('ANTHROPIC_API_KEY', 'inference-fixture');
  setEnv('ANTHROPIC_BASE_URL', 'https://messages.example.test');
  setEnv('HV_AGENT_MODEL', 'claude-test-model');
  delete process.env.HV_WEB_SEARCH;
  if (options.envDisabled) setEnv('HV_WEB_SEARCH', 'off');
  setEnv('HV_WEB_SEARCH_TIMEOUT_MS', options.failure === 'timeout' ? '20' : '20000');
  if (options.apiKey) setEnv('PARALLEL_API_KEY', options.apiKey);
  const calls: { method: string; params?: Record<string, unknown>; headers: Headers }[] = [];
  const modelRequests: Record<string, unknown>[] = [];
  const ac = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit = {}) => {
    const destination = String(url);
    const headers = new Headers(init.headers);
    if (destination === 'https://messages.example.test/v1/messages') {
      assert.equal(headers.get('x-api-key'), 'inference-fixture');
      const request = JSON.parse(String(init.body));
      modelRequests.push(request);
      assert.equal(request.model, 'claude-test-model');
      if (options.disabled || options.envDisabled) {
        assert.equal(request.tools, undefined);
        return stream([{ type: 'text', text: 'Offline storyboard 设计' }]);
      }
      assert.deepEqual(
        request.tools.map((tool: { name: string }) => tool.name),
        ['web_search', 'web_fetch'],
      );
      const step = modelRequests.length;
      if (step === 1 || options.repeat)
        return stream(
          [
            {
              type: 'tool_use',
              id: `search-${step}`,
              name: options.unknownTool ? 'shell' : 'web_search',
              input: {
                objective: 'Research public video facts',
                search_queries: ['public video facts'],
                session_id: 'untrusted',
                model_name: 'untrusted',
              },
            },
          ],
          'tool_use',
        );
      const last = request.messages.at(-1).content[0];
      if (options.failure || options.invalidUrl || options.unknownTool) {
        if (options.invalidUrl && step === 2)
          return stream(
            [
              {
                type: 'tool_use',
                id: 'fetch',
                name: 'web_fetch',
                input: { urls: ['file:///etc/passwd'] },
              },
            ],
            'tool_use',
          );
        assert.equal(last.is_error, true);
        assert.match(last.content, /Research unavailable|quota/i);
        return stream([{ type: 'text', text: 'Research unavailable; please supply sources.' }]);
      }
      assert.equal(last.is_error, false);
      assert.ok(last.content.includes(SOURCE), 'source URL reaches next model request');
      if (step === 2)
        return stream(
          [
            {
              type: 'tool_use',
              id: 'fetch',
              name: 'web_fetch',
              input: { urls: [SOURCE], objective: 'Get the supporting fact' },
            },
          ],
          'tool_use',
        );
      assert.match(last.content, /Verified source fact/);
      return stream(
        [{ type: 'text', text: `Storyboard 设计: Verified source fact [source](${SOURCE})` }],
        'end_turn',
        options.truncated,
      );
    }
    assert.equal(destination, ENDPOINT, 'only the supported MCP endpoint is used');
    assert.equal(headers.get('user-agent'), UA, 'project User-Agent on every MCP request');
    assert.equal(headers.get('authorization'), options.apiKey ? `Bearer ${options.apiKey}` : null);
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const rpc = JSON.parse(String(init.body));
    calls.push({ method: rpc.method, params: rpc.params, headers });
    if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled')
      return new Response(null, { status: 202 });
    const json = (result: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id, result });
    if (rpc.method === 'initialize')
      return json({
        protocolVersion: rpc.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      });
    if (rpc.method === 'tools/list')
      return json({
        tools:
          options.failure === 'discovery'
            ? []
            : ['web_search', 'web_fetch'].map((name) => ({
                name,
                inputSchema: { type: 'object' },
              })),
      });
    assert.equal(rpc.method, 'tools/call');
    assert.equal(rpc.params.arguments.model_name, 'claude-test-model');
    assert.notEqual(rpc.params.arguments.session_id, 'untrusted');
    if (options.failure === 'http') return new Response('service unavailable', { status: 503 });
    if (options.failure === 'tool')
      return json({ isError: true, content: [{ type: 'text', text: 'quota exhausted' }] });
    if (options.failure === 'timeout' || options.failure === 'cancel') {
      if (options.failure === 'cancel') setTimeout(() => ac.abort(), 5);
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        const abort = () => reject(signal?.reason ?? new Error('aborted'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (rpc.params.name === 'web_fetch') assert.deepEqual(rpc.params.arguments.urls, [SOURCE]);
    return json({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results: [{ url: SOURCE, excerpts: ['Verified source fact'] }] }),
        },
      ],
    });
  });
  return { calls, modelRequests, ac };
}

async function run(options: { disabled?: boolean; signal?: AbortSignal } = {}) {
  const events: AgentEvent[] = [];
  const def = findAgent('anthropic-api');
  assert.ok(def);
  const handle = spawnAgent({
    def,
    prompt: 'Research public sources and write a storyboard.',
    context: {
      cwd: '/tmp/html-video-search-fixture',
      ...(options.disabled && { webSearch: false }),
    },
    signal: options.signal,
    onEvent: (event) => events.push(event),
  });
  return {
    ...(await handle.done),
    events,
    text: events
      .filter((e) => e.type === 'text')
      .map((e) => e.chunk)
      .join(''),
  };
}

test('registered HTTP agent consumes anonymous MCP search and fetch in its model loop', async (t) => {
  const f = fixture(t);
  const result = await run();
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Storyboard 设计: Verified source fact/);
  assert.ok(result.text.includes(SOURCE));
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call'],
  );
  const args = f.calls
    .filter((c) => c.method === 'tools/call')
    .map((c) => c.params?.arguments as Record<string, unknown>);
  assert.equal(args[0]?.session_id, args[1]?.session_id);
});

for (const mode of ['per-call', 'environment'] as const)
  test(`search disabled by ${mode} preserves text generation and makes no MCP requests`, async (t) => {
    const f = fixture(t, { disabled: mode === 'per-call', envDisabled: mode === 'environment' });
    const result = await run({ disabled: mode === 'per-call' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.text, 'Offline storyboard 设计');
    assert.equal(f.calls.length, 0);
  });

test('explicit Parallel key is preserved separately from inference credentials', async (t) => {
  fixture(t, { apiKey: 'parallel-fixture' });
  assert.equal((await run()).exitCode, 0);
});

for (const failure of ['http', 'tool', 'timeout', 'discovery'] as const)
  test(`${failure} failure reaches the model as an error without switching providers`, async (t) => {
    fixture(t, { failure });
    const result = await run();
    assert.equal(result.exitCode, 0);
    assert.match(result.text, /Research unavailable/);
    assert.ok(result.events.some((e) => e.type === 'tool_result' && e.isError));
  });

test('cancellation stops the actual MCP caller and model continuation', async (t) => {
  const f = fixture(t, { failure: 'cancel' });
  const result = await run({ signal: f.ac.signal });
  assert.equal(result.exitCode, -1);
  assert.equal(f.modelRequests.length, 1);
});

test('already cancelled invocation sends no requests', async (t) => {
  const f = fixture(t);
  f.ac.abort();
  assert.equal((await run({ signal: f.ac.signal })).exitCode, -1);
  assert.equal(f.modelRequests.length, 0);
  assert.equal(f.calls.length, 0);
});

for (const invalid of ['invalidUrl', 'unknownTool'] as const)
  test(`${invalid} is rejected before sending the tool to MCP`, async (t) => {
    const f = fixture(t, { [invalid]: true });
    const result = await run();
    assert.equal(result.exitCode, 0);
    assert.equal(
      f.calls.filter((c) => c.method === 'tools/call').length,
      invalid === 'invalidUrl' ? 1 : 0,
    );
  });

test('bounded model turns stop an endless research loop', async (t) => {
  fixture(t, { repeat: true });
  const result = await run();
  assert.equal(result.exitCode, -1);
  assert.ok(result.events.some((e) => e.type === 'error' && /round limit/.test(e.message)));
});

test('truncated Messages stream fails instead of accepting partial final output', async (t) => {
  fixture(t, { truncated: true });
  assert.equal((await run()).exitCode, -1);
});

test('plain response without tool use makes no discovery or search requests', async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async (_url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.tools.length, 2);
    return stream([{ type: 'text', text: 'A storyboard from the supplied material.' }]);
  });
  assert.equal((await run()).exitCode, 0);
  assert.equal(f.calls.length, 0);
});

test('configured routing token remains usable without the canonical inference key', async (t) => {
  fixture(t, { disabled: true });
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_AUTH_TOKEN = 'inference-fixture';
  assert.equal((await run({ disabled: true })).exitCode, 0);
});

test('invalid search configuration reports an error before any model or MCP request', async (t) => {
  const f = fixture(t);
  process.env.HV_WEB_SEARCH = 'unknown-provider';
  const result = await run();
  assert.equal(result.exitCode, -1);
  assert.equal(f.modelRequests.length, 0);
  assert.equal(f.calls.length, 0);
});
