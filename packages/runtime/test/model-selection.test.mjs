import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AGENT_DEFS,
  discoverAgentModels,
  discoverAnthropicApiModels,
  findAgent,
  parseCopilotHelpModels,
  parseModelLines,
  parseModelPayload,
} from '../dist/index.js';

const cwd = process.cwd();
const prompt = 'make a frame';

const ARG_CASES = {
  'anthropic-api': { automatic: [], explicit: [] },
  'trae-cli': { automatic: ['acp', 'serve', '--yolo'], explicit: ['acp', 'serve', '--yolo'] },
  claude: { automatic: ['--print'], explicit: ['--print', '--model', 'provider/model-x'] },
  'cursor-agent': { automatic: ['--print'], explicit: ['--print', '--model', 'provider/model-x'] },
  codex: {
    automatic: ['exec', '--skip-git-repo-check'],
    explicit: ['exec', '--skip-git-repo-check', '--model', 'provider/model-x'],
  },
  hermes: {
    automatic: ['chat', '-Q', '-q', prompt],
    explicit: ['chat', '--model', 'provider/model-x', '-Q', '-q', prompt],
  },
  gemini: { automatic: [], explicit: ['--model', 'provider/model-x'] },
  grok: {
    automatic: ['-p', prompt],
    explicit: ['--model', 'provider/model-x', '-p', prompt],
  },
  qwen: { automatic: [], explicit: ['--model', 'provider/model-x'] },
  opencode: { automatic: ['run'], explicit: ['run', '--model', 'provider/model-x'] },
  copilot: {
    automatic: ['--allow-all-tools'],
    explicit: ['--allow-all-tools', '--model', 'provider/model-x'],
  },
  aider: {
    automatic: ['--yes-always', '--no-pretty', '--no-stream', '--message', prompt],
    explicit: ['--yes-always', '--no-pretty', '--no-stream', '--message', prompt, '--model', 'provider/model-x'],
  },
  'qoder-cli': {
    automatic: ['-p', '-', '--permission-mode', 'bypass_permissions', '--dangerously-skip-permissions'],
    explicit: ['-p', '-', '--permission-mode', 'bypass_permissions', '--dangerously-skip-permissions', '--model', 'provider/model-x'],
  },
};

test('all registered agents expose selection while Automatic preserves every existing argv', () => {
  assert.equal(AGENT_DEFS.length, 13);
  assert.deepEqual(AGENT_DEFS.map((def) => def.id), Object.keys(ARG_CASES));
  for (const def of AGENT_DEFS) {
    const expected = ARG_CASES[def.id];
    assert.ok(expected, `missing argv fixture for ${def.id}`);
    assert.equal(def.supportsModelSelection, true, `${def.id} should advertise selection`);
    assert.deepEqual(def.buildArgs(prompt, { cwd }), expected.automatic, `${def.id} Automatic argv changed`);
    assert.deepEqual(
      def.buildArgs(prompt, { cwd, model: 'provider/model-x' }),
      expected.explicit,
      `${def.id} explicit model argv is wrong`,
    );
  }
});

test('manual-only agents degrade without fabricating a catalog', async () => {
  const def = findAgent('claude');
  assert.ok(def);
  const catalog = await discoverAgentModels(def, {
    agentId: def.id,
    bin: process.execPath,
    toolVersion: 'fixture-1.0',
    cwd,
  });
  assert.equal(catalog.status, 'unsupported');
  assert.deepEqual(catalog.models, []);
  assert.match(catalog.source, /no official headless catalog/i);
});

test('official payload and conservative line parsers preserve source-provided ids only', () => {
  assert.deepEqual(parseModelPayload({ data: [
    { id: 'vendor/model-a', display_name: 'Model A', description: 'Fast' },
    { id: 'model-b', name: 'Model B', isDefault: true },
    { id: 'invalid model id', name: 'Must be ignored' },
  ] }), [
    { id: 'vendor/model-a', name: 'Model A', description: 'Fast', availability: 'available' },
    { id: 'model-b', name: 'Model B', isDefault: true, availability: 'available' },
  ]);

  assert.deepEqual(parseModelLines(`
Default model: model-b
Available models:
  * vendor/model-a
  * model-b (default)
This sentence is documentation, not a model id.
  `), [
    { id: 'model-b', name: 'model-b', isDefault: true, availability: 'available' },
    { id: 'vendor/model-a', name: 'vendor/model-a', availability: 'available' },
  ]);
});

test('Copilot help parser stays inside the installed CLI model section', () => {
  const models = parseCopilotHelpModels(`
Usage: copilot [options]
  --agent <name>        Choose an agent
  --model <model>       Choose a model. Values: [vendor/model-a, model-b]
  --silent              Hide status output
  `);
  assert.deepEqual(models.map((model) => model.id), ['vendor/model-a', 'model-b']);
});

test('Anthropic/OpenRouter discovery uses the configured credential host and refuses redirects', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const originalBase = process.env.ANTHROPIC_BASE_URL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = originalToken;
    if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBase;
  });

  process.env.ANTHROPIC_API_KEY = 'fixture-secret';
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api';
  let request;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ data: [{ id: 'vendor/model-live', name: 'Live Model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await discoverAnthropicApiModels({ agentId: 'anthropic-api', cwd });
  assert.equal(request.url, 'https://openrouter.ai/api/v1/models');
  assert.equal(request.init.redirect, 'manual');
  assert.equal(request.init.headers.authorization, 'Bearer fixture-secret');
  assert.equal(request.init.headers['x-api-key'], undefined);
  assert.deepEqual(result.models.map((model) => model.id), ['vendor/model-live']);

  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://different.example/models' },
  });
  await assert.rejects(
    discoverAnthropicApiModels({ agentId: 'anthropic-api', cwd }),
    /refused an HTTP redirect/i,
  );
});

test('Anthropic HTTP invocation uses explicit context model and keeps env fallback in Automatic', async (t) => {
  const def = findAgent('anthropic-api');
  assert.ok(def?.httpHandler);
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalBase = process.env.ANTHROPIC_BASE_URL;
  const originalModel = process.env.HV_AGENT_MODEL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBase;
    if (originalModel === undefined) delete process.env.HV_AGENT_MODEL;
    else process.env.HV_AGENT_MODEL = originalModel;
  });
  process.env.ANTHROPIC_API_KEY = 'fixture-secret';
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
  process.env.HV_AGENT_MODEL = 'env-default-model';
  const bodies = [];
  const requestOptions = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    requestOptions.push(init);
    return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const signal = new AbortController().signal;
  await def.httpHandler('prompt', { cwd, model: 'explicit-model' }, () => {}, signal);
  await def.httpHandler('prompt', { cwd }, () => {}, signal);
  assert.equal(bodies[0].model, 'explicit-model');
  assert.equal(bodies[1].model, 'env-default-model');
  assert.equal(requestOptions[0].redirect, 'manual');
});
