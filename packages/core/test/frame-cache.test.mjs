import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  frameCachePath,
  frameRenderFingerprint,
  isForceRerender,
  planFrameRender,
  shouldReuseFrameRender,
  stableStringify,
} from '../dist/frame-cache.js';

const base = {
  durationSec: 4,
  engine: 'hyperframes',
  html: '<html>hello</html>',
  width: 1920,
  height: 1080,
  fps: 60,
  variables: { title: 'A' },
};

test('stableStringify sorts object keys', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('fingerprint is stable for identical inputs', () => {
  assert.equal(frameRenderFingerprint(base), frameRenderFingerprint({ ...base }));
});

test('fingerprint changes when HTML, duration, fps, or variables change', () => {
  const a = frameRenderFingerprint(base);
  assert.notEqual(a, frameRenderFingerprint({ ...base, html: '<html>other</html>' }));
  assert.notEqual(a, frameRenderFingerprint({ ...base, durationSec: 6 }));
  assert.notEqual(a, frameRenderFingerprint({ ...base, fps: 30 }));
  assert.notEqual(a, frameRenderFingerprint({ ...base, variables: { title: 'B' } }));
  assert.notEqual(a, frameRenderFingerprint({ ...base, width: 1280, height: 720 }));
});

test('variable key order does not bust the cache', () => {
  const left = frameRenderFingerprint({ ...base, variables: { b: 1, a: 2 } });
  const right = frameRenderFingerprint({ ...base, variables: { a: 2, b: 1 } });
  assert.equal(left, right);
});

test('Remotion native fingerprint follows data, not unused HTML', () => {
  const native = {
    ...base,
    engine: 'remotion',
    nativeTemplateId: 'frame-data-rollup',
    data: { title: 'KPI', items: [{ label: 'A', value: 10 }] },
  };
  const htmlSwap = frameRenderFingerprint({ ...native, html: '<html>edited</html>' });
  assert.equal(frameRenderFingerprint(native), htmlSwap);
  assert.notEqual(
    frameRenderFingerprint(native),
    frameRenderFingerprint({
      ...native,
      data: { title: 'KPI', items: [{ label: 'A', value: 99 }] },
    }),
  );
  assert.notEqual(
    frameRenderFingerprint(native),
    frameRenderFingerprint({ ...native, nativeTemplateId: 'frame-data-donut' }),
  );
});

test('shouldReuseFrameRender requires matching fingerprint and a non-empty file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hv-cache-'));
  const cachePath = join(dir, 'intro.mp4');
  const fp = 'abc';
  assert.equal(
    shouldReuseFrameRender({ fingerprint: fp, previousFingerprint: fp, cachePath }),
    false,
  );
  await writeFile(cachePath, '');
  assert.equal(
    shouldReuseFrameRender({ fingerprint: fp, previousFingerprint: fp, cachePath }),
    false,
  );
  await writeFile(cachePath, 'not-empty');
  assert.equal(
    shouldReuseFrameRender({ fingerprint: fp, previousFingerprint: fp, cachePath }),
    true,
  );
  assert.equal(
    shouldReuseFrameRender({
      fingerprint: fp,
      previousFingerprint: 'other',
      cachePath,
    }),
    false,
  );
  assert.equal(
    shouldReuseFrameRender({
      fingerprint: fp,
      previousFingerprint: fp,
      cachePath,
      force: true,
    }),
    false,
  );
});

test('isForceRerender reads HV_FORCE_RERENDER', () => {
  assert.equal(isForceRerender({}), false);
  assert.equal(isForceRerender({ HV_FORCE_RERENDER: '1' }), true);
  assert.equal(isForceRerender({ HV_FORCE_RERENDER: 'true' }), true);
  assert.equal(isForceRerender({ HV_FORCE_RERENDER: '0' }), false);
});

test('planFrameRender reuses only when fingerprint + cache file match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hv-plan-'));
  const framesDir = join(dir, 'frames');
  const cacheDir = join(framesDir, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const htmlPath = join(framesDir, '01-intro.html');
  await writeFile(htmlPath, '<html>one</html>');

  const frame = {
    graphNodeId: 'intro',
    htmlPath,
    durationSec: 4,
    order: 0,
  };
  const common = {
    frame,
    projectEngine: 'hyperframes',
    resolution: { width: 1920, height: 1080 },
    fps: 60,
    variables: {},
    cacheDir,
  };

  const first = await planFrameRender(common);
  assert.equal(first.reuse, false);
  assert.equal(first.cachePath, frameCachePath(cacheDir, 'intro'));

  await writeFile(first.cachePath, 'fake-mp4');
  const second = await planFrameRender({
    ...common,
    frame: { ...frame, renderFingerprint: first.fingerprint },
  });
  assert.equal(second.reuse, true);
  assert.equal(second.fingerprint, first.fingerprint);

  await writeFile(htmlPath, '<html>two</html>');
  const third = await planFrameRender({
    ...common,
    frame: { ...frame, renderFingerprint: first.fingerprint },
  });
  assert.equal(third.reuse, false);
  assert.notEqual(third.fingerprint, first.fingerprint);
});
