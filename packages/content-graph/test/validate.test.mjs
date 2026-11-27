import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, topoSort } from '../dist/index.js';

// Regression coverage for issue #57, finding 25: validate() never checked the
// edge `kind` field, so a graph parsed from agent JSON could carry an unknown
// kind and slip through into rendering.

const graphWith = (edges) => ({
  schemaVersion: 1,
  intent: 'explainer',
  nodes: [
    { id: 'a', kind: 'text', text: 'A' },
    { id: 'b', kind: 'text', text: 'B' },
  ],
  edges,
});

test('valid edge kinds pass validation', () => {
  const result = validate(
    graphWith([
      { from: 'a', to: 'b', kind: 'sequence' },
      { from: 'a', to: 'b', kind: 'dependency' },
      { from: 'a', to: 'b', kind: 'contrast' },
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('unknown edge kind is reported as invalid-kind', () => {
  const result = validate(graphWith([{ from: 'a', to: 'b', kind: 'follows' }]));
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === 'invalid-kind');
  assert.ok(err, 'expected an invalid-kind error');
  assert.match(err.message, /follows/);
});

test('topoSort still orders dependency edges correctly', () => {
  const order = topoSort(graphWith([{ from: 'a', to: 'b', kind: 'dependency' }]));
  assert.deepEqual(order, ['a', 'b']);
});
