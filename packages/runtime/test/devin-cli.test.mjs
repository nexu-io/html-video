import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENT_DEFS, findAgent } from '../dist/index.js';

test('Devin CLI is registered as a public ACP runtime', () => {
  const devinCli = findAgent('devin-cli');

  assert.ok(devinCli, 'devin-cli should be registered');
  assert.equal(devinCli.name, 'Devin CLI');
  assert.equal(devinCli.bin, 'devin');
  assert.equal(devinCli.streamFormat, 'acp-json-rpc');
  assert.equal(devinCli.promptViaStdin, undefined);
  assert.equal(devinCli.kind, undefined);
  assert.ok(AGENT_DEFS.includes(devinCli));
});

test('Devin CLI ACP launch args start the ACP stdio server', () => {
  const devinCli = findAgent('devin-cli');

  assert.deepEqual(devinCli.buildArgs('', { cwd: '/tmp/html-video-project' }), [
    'acp',
  ]);
});
