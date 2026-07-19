import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_NATIVE_TEMPLATE_ID,
  isKnownNativeTemplateId,
  normalizeNativeData,
} from '../dist/native-data.js';

const sample = {
  title: 'Weekly',
  unit: 'K',
  items: [
    { label: 'Mon', value: 10 },
    { label: 'Tue', value: 20 },
  ],
};

test('normalizeNativeData maps items → points for line', () => {
  const out = normalizeNativeData(sample, 'frame-data-line');
  assert.equal(out.title, 'Weekly');
  assert.equal(out.unit, 'K');
  assert.deepEqual(out.points, sample.items);
  assert.equal(out.items, undefined);
});

test('normalizeNativeData maps items → axes for radar', () => {
  const out = normalizeNativeData(sample, 'frame-data-radar');
  assert.deepEqual(out.axes, sample.items);
});

test('normalizeNativeData keeps items for rollup/donut/hbars', () => {
  for (const id of ['frame-data-rollup', 'frame-data-donut', 'frame-data-hbars']) {
    const out = normalizeNativeData(sample, id);
    assert.deepEqual(out.items, sample.items);
  }
});

test('normalizeNativeData accepts points alias as source', () => {
  const out = normalizeNativeData(
    { points: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
    'frame-data-rollup',
  );
  assert.deepEqual(out.items, [
    { label: 'A', value: 1 },
    { label: 'B', value: 2 },
  ]);
});

test('known native ids + default', () => {
  assert.equal(DEFAULT_NATIVE_TEMPLATE_ID, 'frame-data-rollup');
  assert.equal(isKnownNativeTemplateId('frame-data-donut'), true);
  assert.equal(isKnownNativeTemplateId('frame-bold-poster'), false);
});
