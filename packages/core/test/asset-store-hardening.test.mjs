import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AssetStore, HtmlVideoError } from '../dist/index.js';

// Regression coverage for issue #57 findings 5, 14, 26 (asset-store) and
// finding 15 (HtmlVideoError.toJSON vs non-serialisable context).

let root;
test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'hv-asset-store-'));
});

test.after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('addBufferAsset rejects path-traversal extensions (finding 5)', async () => {
  const store = new AssetStore({ projectRoot: root });
  await assert.rejects(
    store.addBufferAsset('proj_x', Buffer.from('hello'), '../../evil'),
    /invalid extension/,
  );
  await assert.rejects(
    store.addBufferAsset('proj_x', Buffer.from('hello'), '.mp3/extra'),
    /invalid extension/,
  );
});

test('addBufferAsset accepts real extensions and stays inside the assets dir', async () => {
  const store = new AssetStore({ projectRoot: root });
  const asset = await store.addBufferAsset('proj_x', Buffer.from('audio-bytes'), '.mp3');
  const stored = await readFile(asset.path, 'utf8');
  assert.equal(stored, 'audio-bytes');
  assert.ok(asset.path.includes(join('.html-video', 'projects', 'proj_x', 'assets')));
  assert.equal(asset.metadata.mimeType, 'audio/mpeg');
});

test('computeId streams large files (finding 14) and matches the inline hash', async () => {
  const dir = join(root, 'files');
  await mkdir(dir, { recursive: true });
  const big = Buffer.alloc(5 * 1024 * 1024 + 123);
  for (let i = 0; i < big.length; i += 4096) {
    big.fill(i & 0xff, i, Math.min(i + 4096, big.length));
  }
  const file = join(dir, 'big.bin');
  await writeFile(file, big);
  const expected = createHash('sha1').update(big).digest('hex');
  assert.equal(await AssetStore.computeId(file), expected);
});

test('addFileAsset records the basename of the source path (finding 26)', async () => {
  const store = new AssetStore({ projectRoot: root });
  const dir = join(root, 'files');
  const realFile = join(dir, 'logo.png');
  await mkdir(dir, { recursive: true });
  await writeFile(realFile, Buffer.from('png-bytes'));
  const asset = await store.addFileAsset('proj_x', realFile);
  assert.equal(asset.metadata.filename, 'logo.png');
});

test('HtmlVideoError.toJSON survives circular / non-serialisable context (finding 15)', () => {
  const circular = { self: null };
  circular.self = circular;
  const err = new HtmlVideoError('render-failed', 'boom', false, {
    ok: { a: 1 },
    circular,
    fn: () => {},
  });
  const json = JSON.parse(JSON.stringify(err));
  assert.equal(json.name, 'HtmlVideoError');
  assert.equal(json.code, 'render-failed');
  assert.deepEqual(json.context.ok, { a: 1 });
  assert.match(json.context.circular.note, /not JSON-serialisable/);
  assert.match(json.context.fn.note, /not JSON-serialisable/);
});
