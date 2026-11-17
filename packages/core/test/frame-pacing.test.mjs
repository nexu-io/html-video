import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topoSort } from '@html-video/content-graph';
import {
  applyFrameDuration,
  clampFrameDurationSec,
  reorderContentGraph,
  reorderFrameRecords,
} from '../dist/frame-pacing.js';

const sampleGraph = {
  schemaVersion: 1,
  intent: 'explainer',
  synopsis: 'Three-frame',
  nodes: [
    { id: 'intro', kind: 'text', text: 'A', durationSec: 2 },
    { id: 'middle', kind: 'data', data: { v: 1 }, durationSec: 4 },
    { id: 'outro', kind: 'text', text: 'Z', durationSec: 3 },
  ],
  edges: [
    { from: 'intro', to: 'middle', kind: 'sequence' },
    { from: 'middle', to: 'outro', kind: 'sequence' },
    { from: 'intro', to: 'outro', kind: 'contrast', reason: 'bookend' },
    { from: 'middle', to: 'outro', kind: 'dependency' },
  ],
};

const sampleFrames = [
  {
    graphNodeId: 'intro',
    htmlPath: '/tmp/i.html',
    durationSec: 2,
    order: 0,
    engine: 'hyperframes',
  },
  {
    graphNodeId: 'middle',
    htmlPath: '/tmp/m.html',
    durationSec: 4,
    order: 1,
    engine: 'remotion',
    nativeTemplateId: 'frame-data-rollup',
  },
  { graphNodeId: 'outro', htmlPath: '/tmp/o.html', durationSec: 3, order: 2 },
];

test('clampFrameDurationSec bounds and rounds', () => {
  assert.equal(clampFrameDurationSec(0), 0.5);
  assert.equal(clampFrameDurationSec(100), 60);
  assert.equal(clampFrameDurationSec(4.16), 4.2);
  assert.equal(clampFrameDurationSec(Number.NaN), 0.5);
});

test('reorderContentGraph rebuilds sequence chain and keeps contrast', () => {
  const next = reorderContentGraph(sampleGraph, ['outro', 'intro', 'middle']);
  assert.deepEqual(
    next.nodes.map((n) => n.id),
    ['outro', 'intro', 'middle'],
  );
  assert.deepEqual(
    next.edges.filter((e) => e.kind === 'sequence'),
    [
      { from: 'outro', to: 'intro', kind: 'sequence' },
      { from: 'intro', to: 'middle', kind: 'sequence' },
    ],
  );
  assert.equal(
    next.edges.some((e) => e.kind === 'dependency'),
    false,
  );
  assert.equal(
    next.edges.some((e) => e.kind === 'contrast'),
    true,
  );
  assert.deepEqual(topoSort(next), ['outro', 'intro', 'middle']);
});

test('reorderContentGraph rejects bad permutations', () => {
  assert.throws(() => reorderContentGraph(sampleGraph, ['intro', 'middle']));
  assert.throws(() => reorderContentGraph(sampleGraph, ['intro', 'middle', 'nope']));
  assert.throws(() => reorderContentGraph(sampleGraph, ['intro', 'intro', 'middle']));
});

test('reorderFrameRecords preserves enhance fields and reindexes order', () => {
  const next = reorderFrameRecords(sampleFrames, ['outro', 'intro', 'middle']);
  assert.deepEqual(
    next.map((f) => ({ id: f.graphNodeId, order: f.order })),
    [
      { id: 'outro', order: 0 },
      { id: 'intro', order: 1 },
      { id: 'middle', order: 2 },
    ],
  );
  assert.equal(next[2].nativeTemplateId, 'frame-data-rollup');
  assert.equal(next[2].htmlPath, '/tmp/m.html');
});

test('applyFrameDuration updates graph node and frame together', () => {
  const { graph, frames, durationSec } = applyFrameDuration(
    sampleGraph,
    sampleFrames,
    'middle',
    7.25,
  );
  assert.equal(durationSec, 7.3);
  assert.equal(graph.nodes.find((n) => n.id === 'middle')?.durationSec, 7.3);
  assert.equal(frames.find((f) => f.graphNodeId === 'middle')?.durationSec, 7.3);
  assert.equal(frames.find((f) => f.graphNodeId === 'intro')?.durationSec, 2);
});
