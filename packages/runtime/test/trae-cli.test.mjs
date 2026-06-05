import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';

import { AGENT_DEFS, findAgent } from '../dist/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('Trae CLI is registered as a public ACP runtime', () => {
  const traeCli = findAgent('trae-cli');

  assert.ok(traeCli, 'trae-cli should be registered');
  assert.equal(traeCli.name, 'Trae CLI');
  assert.equal(traeCli.bin, 'traecli');
  assert.equal(traeCli.streamFormat, 'acp-json-rpc');
  assert.equal(traeCli.promptViaStdin, undefined);
  assert.equal(traeCli.kind, undefined);
  assert.ok(AGENT_DEFS.includes(traeCli));
});

test('Trae CLI ACP launch uses yolo mode for non-interactive studio runs', () => {
  const traeCli = findAgent('trae-cli');

  assert.deepEqual(traeCli.buildArgs('', { cwd: '/tmp/html-video-project' }), [
    'acp',
    'serve',
    '--yolo',
  ]);
});

test('Trae CLI public surface does not expose internal COCO details', async () => {
  const files = await Promise.all([
    readFile(join(repoRoot, 'packages/runtime/src/defs/trae-cli.ts'), 'utf8'),
    readFile(join(repoRoot, 'packages/runtime/src/registry.ts'), 'utf8'),
    readFile(join(repoRoot, 'README.md'), 'utf8'),
    readFile(join(repoRoot, 'README.zh-CN.md'), 'utf8'),
  ]);
  const publicSurface = files.join('\n').toLowerCase();

  for (const forbidden of [
    'coco',
    'code.byted.org',
    'codebase-api.byted.org',
    'bytedance',
    '/users/bytedance',
    'bytedance sso',
    'install_coco',
  ]) {
    assert.equal(
      publicSurface.includes(forbidden),
      false,
      `public surface should not contain ${forbidden}`,
    );
  }
});
