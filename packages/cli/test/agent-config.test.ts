import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AgentConfigStore, resolveAgentModelSelection } from '../dist/index.js';

test('agent model precedence is project override, global selection, then native default', () => {
  assert.equal(resolveAgentModelSelection('project-model', 'global-model'), 'project-model');
  assert.equal(resolveAgentModelSelection(null, 'global-model'), 'global-model');
  assert.equal(resolveAgentModelSelection('', 'global-model'), 'global-model');
  assert.equal(resolveAgentModelSelection(undefined, null), undefined);
});

test('AgentConfigStore persists only explicit selections and null restores Automatic', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'html-video-agent-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentConfigStore(root);

  assert.equal(store.get('codex'), null);
  assert.equal(store.set('codex', 'vendor/model-a'), 'vendor/model-a');
  assert.equal(store.get('codex'), 'vendor/model-a');
  assert.deepEqual(store.list(), { codex: 'vendor/model-a' });

  const file = JSON.parse(readFileSync(join(root, '.html-video', 'agent-config.json'), 'utf8'));
  assert.deepEqual(file, { version: 1, models: { codex: 'vendor/model-a' } });
  assert.equal('catalog' in file, false);

  assert.equal(store.set('codex', null), null);
  assert.equal(store.get('codex'), null);
  assert.deepEqual(store.list(), {});
  assert.throws(() => store.set('codex', 'invalid model id'), /Model id/);
});
