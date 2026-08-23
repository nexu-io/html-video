import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  projectEnhanceFrame,
  projectGetGraph,
  projectSetGraph,
  projectUnenhanceFrame,
  projectWriteFrame,
} from '../dist/commands/project.js';
import { bootstrap } from '../dist/context.js';

/** Capture ok() JSON output without exiting. */
function captureOk(fn: () => Promise<void>): Promise<Record<string, unknown>> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof process.stdout.write;
  return fn()
    .then(() => {
      process.stdout.write = orig;
      const line = chunks.join('').trim().split('\n').pop() ?? '{}';
      return JSON.parse(line) as Record<string, unknown>;
    })
    .catch((err) => {
      process.stdout.write = orig;
      throw err;
    });
}

test('multi-frame CLI path: set graph → write frames → enhance → unenhance', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'hv-cli-frames-'));
  await mkdir(join(projectRoot, '.html-video'), { recursive: true });
  const monorepoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const ctx = await bootstrap({ cwd: projectRoot });
  if (ctx.templates.list().length === 0) {
    await ctx.templates.scan(join(monorepoRoot, 'templates'));
  }

  const project = await ctx.orchestrator.create({
    name: 'CLI frames test',
    intent: 'Exercise project-set-graph / write-frame / enhance commands',
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

  const graphFile = join(projectRoot, 'graph.json');
  await writeFile(graphFile, JSON.stringify(graph), 'utf8');

  const setRes = await captureOk(() => projectSetGraph(ctx, project.id, { graphFile }));
  assert.equal(setRes.frame_count, 0);
  assert.ok(setRes.graph_path);

  const getRes = await captureOk(() => projectGetGraph(ctx, project.id));
  assert.equal((getRes.graph as { nodes: unknown[] }).nodes.length, 3);

  for (const node of graph.nodes) {
    const html = `<!doctype html><html><body>${node.id}</body></html>`;
    const frameRes = await captureOk(() =>
      projectWriteFrame(ctx, project.id, { node: node.id, html }),
    );
    assert.equal((frameRes.frame as { graph_node_id: string }).graph_node_id, node.id);
  }

  const enhanced = await captureOk(() =>
    projectEnhanceFrame(ctx, project.id, {
      node: 'stats',
      nativeTemplate: 'frame-data-rollup',
    }),
  );
  assert.equal((enhanced.frame as { engine: string }).engine, 'remotion');
  assert.equal(
    (enhanced.frame as { native_template_id: string }).native_template_id,
    'frame-data-rollup',
  );

  // Remap the same items-shaped node data onto a line chart (points).
  const asLine = await captureOk(() =>
    projectEnhanceFrame(ctx, project.id, {
      node: 'stats',
      nativeTemplate: 'frame-data-line',
    }),
  );
  assert.equal(
    (asLine.frame as { native_template_id: string }).native_template_id,
    'frame-data-line',
  );
  const lineData = (asLine.frame as { data?: { points?: unknown[] } }).data;
  assert.ok(Array.isArray(lineData?.points));
  assert.equal(lineData?.points?.length, 2);

  const reverted = await captureOk(() => projectUnenhanceFrame(ctx, project.id, 'stats'));
  assert.equal((reverted.frame as { engine?: string }).engine, undefined);

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
