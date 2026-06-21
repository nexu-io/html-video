import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENT_DEFS, findAgent } from '../dist/index.js';

test('CodeBuddy CLI is registered as a plain runtime', () => {
  const codebuddy = findAgent('codebuddy');

  assert.ok(codebuddy, 'codebuddy should be registered');
  assert.equal(codebuddy.name, 'CodeBuddy CLI');
  assert.equal(codebuddy.bin, 'codebuddy');
  assert.equal(codebuddy.streamFormat, 'plain');
  assert.equal(codebuddy.promptViaStdin, true);
  assert.deepEqual(codebuddy.versionArgs, ['--version']);
  assert.equal(codebuddy.kind, undefined);
  assert.ok(AGENT_DEFS.includes(codebuddy));
});

test('CodeBuddy CLI buildArgs returns the official headless flags', () => {
  const codebuddy = findAgent('codebuddy');

  assert.deepEqual(codebuddy.buildArgs('', { cwd: '/tmp/html-video-project' }), [
    '-p',
    '--dangerously-skip-permissions',
  ]);
});
