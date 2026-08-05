import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topoSort, totalDurationSec, validate } from '../dist/index.js';

const sampleGraph = {
  schemaVersion: 1,
  intent: 'explainer',
  synopsis: 'Three-frame explainer',
  nodes: [
    { id: 'intro', kind: 'text', text: 'Hello', durationSec: 2 },
    { id: 'middle', kind: 'data', data: { v: 42 }, durationSec: 4 },
    { id: 'outro', kind: 'entity', props: { logo: 'OD' }, durationSec: 3 },
  ],
  edges: [
    { from: 'intro', to: 'middle', kind: 'sequence' },
    { from: 'middle', to: 'outro', kind: 'dependency' },
  ],
};

test('validate accepts a well-formed graph', () => {
  const result = validate(sampleGraph);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test('validate rejects empty graph', () => {
  const result = validate({ ...sampleGraph, nodes: [] });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'empty-graph');
});

test('validate rejects duplicate node ids', () => {
  const result = validate({
    ...sampleGraph,
    nodes: [
      { id: 'dup', kind: 'text', text: 'a' },
      { id: 'dup', kind: 'text', text: 'b' },
    ],
    edges: [],
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((e) => e.code === 'duplicate-node-id'),
    true,
  );
});

test('validate rejects dependency cycles', () => {
  const result = validate({
    ...sampleGraph,
    nodes: [
      { id: 'a', kind: 'text', text: 'a' },
      { id: 'b', kind: 'text', text: 'b' },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'dependency' },
      { from: 'b', to: 'a', kind: 'dependency' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((e) => e.code === 'cycle'),
    true,
  );
});

test('topoSort honours dependency + sequence edges', () => {
  assert.deepEqual(topoSort(sampleGraph), ['intro', 'middle', 'outro']);
});

test('totalDurationSec sums per-frame durations', () => {
  assert.equal(totalDurationSec(sampleGraph), 9);
});
