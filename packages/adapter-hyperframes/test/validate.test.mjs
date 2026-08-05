import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../dist/validate.js';

test('validate rejects non-hyperframes engine', () => {
  const result = validate({
    id: 'x',
    engine: 'remotion',
    sourcePath: '/tmp/nope.html',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'engine-mismatch');
});

test('validate rejects missing sourcePath', () => {
  const result = validate({
    id: 'x',
    engine: 'hyperframes',
    sourcePath: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.code, 'missing-source');
});
