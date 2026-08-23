import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { bootstrap } from '../dist/context.js';

test('multi-frame path: set graph → write frames → enhance → unenhance', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'hv-cli-frames-'));
  await mkdir(join(projectRoot, '.html-video'), { recursive: true });
  const monorepoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const ctx = await bootstrap({ cwd: projectRoot });
  if (ctx.templates.list().length === 0) {
    await ctx.templates.scan(join(monorepoRoot, 'templates'));
  }

  const project = await ctx.orchestrator.create({
    name: 'CLI frames test',
    intent: 'Exercise writeContentGraph / writeFrameHtml / enhanceFrameNative',
    preferences: {},
  });

  const graph = {
    schemaVersion: 1,
    intent: 'explainer',
    synopsis: 'CLI integration test',
    nodes: [
      { id: 'intro', kind: 'text', text: 'Hi', durationSec: 2 },
      {
        id: 'stats',
        kind: 'data',
        data: {
          items: [
            { label: 'A', value: 10 },
            { label: 'B', value: 20 },
          ],
        },
        durationSec: 4,
      },
      { id: 'outro', kind: 'text', text: 'Bye', durationSec: 2 },
    ],
    edges: [
      { from: 'intro', to: 'stats', kind: 'sequence' },
      { from: 'stats', to: 'outro', kind: 'dependency' },
    ],
  };

  const { project: afterGraph } = await ctx.orchestrator.writeContentGraph(
    project.id,
    graph as never,
  );
  assert.equal(afterGraph.frames?.length ?? 0, 0);

  const loadedGraph = await ctx.orchestrator.readContentGraph(project.id);
  assert.equal(loadedGraph?.nodes.length, 3);

  for (const node of graph.nodes) {
    const html = `<!doctype html><html><body>${node.id}</body></html>`;
    const { frame } = await ctx.orchestrator.writeFrameHtml(project.id, node.id, html);
    assert.equal(frame.graphNodeId, node.id);
  }

  const { frame: enhanced } = await ctx.orchestrator.enhanceFrameNative(
    project.id,
    'stats',
    'frame-data-rollup',
  );
  assert.equal(enhanced.engine, 'remotion');
  assert.equal(enhanced.nativeTemplateId, 'frame-data-rollup');

  const { frame: reverted } = await ctx.orchestrator.unenhanceFrame(project.id, 'stats');
  assert.equal(reverted.engine, undefined);

  const loaded = await ctx.orchestrator.load(project.id);
  assert.equal(loaded.frames?.length, 3);
  assert.equal(loaded.frames?.map((f) => f.graphNodeId).join(','), 'intro,stats,outro');
});

test('enhanceFrameNative rejects non-data frames', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'hv-cli-enh-reject-'));
  await mkdir(join(projectRoot, '.html-video'), { recursive: true });
  const monorepoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const ctx = await bootstrap({ cwd: projectRoot });
  if (ctx.templates.list().length === 0) {
    await ctx.templates.scan(join(monorepoRoot, 'templates'));
  }

  const project = await ctx.orchestrator.create({ name: 'enhance reject', preferences: {} });
  const graph = {
    schemaVersion: 1,
    intent: 'explainer',
    nodes: [
      { id: 'intro', kind: 'text', text: 'Hi', durationSec: 2 },
      {
        id: 'stats',
        kind: 'data',
        data: { items: [{ label: 'A', value: 1 }] },
        durationSec: 3,
      },
    ],
    edges: [{ from: 'intro', to: 'stats', kind: 'sequence' }],
  };
  await ctx.orchestrator.writeContentGraph(project.id, graph as never);
  await ctx.orchestrator.writeFrameHtml(
    project.id,
    'intro',
    '<!doctype html><html><body>intro</body></html>',
  );
  await ctx.orchestrator.writeFrameHtml(
    project.id,
    'stats',
    '<!doctype html><html><body>stats</body></html>',
  );

  await assert.rejects(
    () => ctx.orchestrator.enhanceFrameNative(project.id, 'intro', 'frame-data-rollup'),
    (err: unknown) => err instanceof Error && /data node|data frames/i.test(err.message),
  );

  // Happy path still works on the data frame (regression vs reject-all).
  const { frame } = await ctx.orchestrator.enhanceFrameNative(
    project.id,
    'stats',
    'frame-data-rollup',
  );
  assert.equal(frame.engine, 'remotion');
});

test('reorderFrames + setFrameDuration keep HTML and update order/duration', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'hv-cli-pace-'));
  await mkdir(join(projectRoot, '.html-video'), { recursive: true });
  const monorepoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const ctx = await bootstrap({ cwd: projectRoot });
  if (ctx.templates.list().length === 0) {
    await ctx.templates.scan(join(monorepoRoot, 'templates'));
  }

  const project = await ctx.orchestrator.create({ name: 'pace', preferences: {} });
  const graph = {
    schemaVersion: 1,
    intent: 'explainer',
    nodes: [
      { id: 'a', kind: 'text', text: 'A', durationSec: 2 },
      { id: 'b', kind: 'text', text: 'B', durationSec: 3 },
      { id: 'c', kind: 'text', text: 'C', durationSec: 4 },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sequence' },
      { from: 'b', to: 'c', kind: 'sequence' },
    ],
  };
  await ctx.orchestrator.writeContentGraph(project.id, graph as never);
  for (const id of ['a', 'b', 'c']) {
    await ctx.orchestrator.writeFrameHtml(
      project.id,
      id,
      `<!doctype html><html><body>${id}</body></html>`,
    );
  }

  const { project: reordered } = await ctx.orchestrator.reorderFrames(project.id, ['c', 'a', 'b']);
  assert.deepEqual(
    reordered.frames?.map((f) => f.graphNodeId),
    ['c', 'a', 'b'],
  );
  // HTML paths must survive reorder (dirty-frame cache keys off node id).
  for (const f of reordered.frames ?? []) {
    assert.match(f.htmlPath, new RegExp(`${f.graphNodeId}\\.html$`));
  }

  const { durationSec, frame } = await ctx.orchestrator.setFrameDuration(project.id, 'a', 9);
  assert.equal(durationSec, 9);
  assert.equal(frame.durationSec, 9);

  const g = await ctx.orchestrator.readContentGraph(project.id);
  assert.deepEqual(
    g?.nodes.map((n) => n.id),
    ['c', 'a', 'b'],
  );
  assert.equal(g?.nodes.find((n) => n.id === 'a')?.durationSec, 9);
});
