import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineRegistry, HtmlVideoError } from '../dist/index.js';

test('EngineRegistry registers and lists adapters', () => {
  const registry = new EngineRegistry();
  registry.register({
    id: 'hyperframes',
    name: 'Hyperframes',
    upstreamVersion: 'test',
    capabilities: {},
    validate: () => ({ ok: true, errors: [], warnings: [] }),
    render: async () => ({
      outputPath: '/tmp/x.mp4',
      meta: {
        durationSec: 1,
        fileSizeBytes: 100,
        actualResolution: { width: 1920, height: 1080 },
        fps: 30,
        renderedFrames: 30,
        renderWallClockSec: 0.1,
        engineVersion: 'test',
      },
      diagnostics: [],
    }),
  });
  assert.equal(registry.has('hyperframes'), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get('hyperframes').id, 'hyperframes');
});

test('EngineRegistry.get throws HtmlVideoError for unknown engine', () => {
  const registry = new EngineRegistry();
  assert.throws(
    () => registry.get('remotion'),
    (err) => err instanceof HtmlVideoError && err.code === 'engine-not-registered',
  );
});
