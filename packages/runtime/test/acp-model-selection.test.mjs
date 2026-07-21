import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { discoverAcpModels, runAcpAgent } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./fixtures/acp-model-server.mjs', import.meta.url));
const cwd = process.cwd();

function run(mode, model) {
  const events = [];
  const controller = new AbortController();
  return runAcpAgent({
    bin: process.execPath,
    args: [fixture, mode],
    prompt: 'hello',
    cwd,
    ...(model && { model }),
    onEvent: (event) => events.push(event),
    signal: controller.signal,
  }).then((result) => ({ result, events }));
}

test('ACP discovery reads the announced category=model select option', async () => {
  const result = await discoverAcpModels({
    bin: process.execPath,
    args: [fixture, 'modern'],
    cwd,
  });
  assert.equal(result.status, undefined);
  assert.deepEqual(result.models, [
    {
      id: 'model-a',
      name: 'Model A',
      description: 'Default fixture',
      isDefault: true,
      availability: 'available',
    },
    { id: 'model-b', name: 'Model B', availability: 'available' },
  ]);
});

test('ACP explicit model uses modern session/set_config_option', async () => {
  const { result, events } = await run('modern', 'model-b');
  assert.equal(result.exitCode, 0);
  assert.equal(events.find((event) => event.type === 'text')?.chunk, 'selected:model-b');
});

test('ACP rejects a model absent from the announced values without fallback', async () => {
  const { result, events } = await run('modern', 'missing-model');
  assert.equal(result.exitCode, -1);
  assert.match(events.find((event) => event.type === 'error')?.message ?? '', /not advertised/i);
  assert.equal(events.some((event) => event.type === 'text'), false);
});

test('ACP Automatic performs no selection request', async () => {
  const { result, events } = await run('no-config');
  assert.equal(result.exitCode, 0);
  assert.equal(events.find((event) => event.type === 'text')?.chunk, 'selected:automatic');
});

test('ACP refuses legacy session/set_model unless initialize advertises it', async () => {
  const unsupported = await run('no-config', 'model-b');
  assert.equal(unsupported.result.exitCode, -1);
  assert.match(unsupported.events.find((event) => event.type === 'error')?.message ?? '', /did not advertise/i);

  const legacy = await run('legacy', 'model-b');
  assert.equal(legacy.result.exitCode, 0);
  assert.equal(legacy.events.find((event) => event.type === 'text')?.chunk, 'selected:model-b');
});
