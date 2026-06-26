import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormatReply } from '../dist/studio-server.js';

// Regression coverage for issue #2: a typed free-text format answer (when the
// model asked in prose instead of rendering the hv-form card) must parse into
// the same {aspect, duration, frame_count} shape a card submit produces, so the
// flow advances to confirm instead of re-asking.

test('the exact issue #2 reply: "16:9 landscape / 5s / 10"', () => {
  const r = parseFormatReply('16:9 landscape / 5s / 10');
  assert.equal(r?.aspect, '16:9 landscape');
  assert.equal(r?.duration, '5');
  assert.equal(r?.frame_count, '10');
});

test('comma-separated duration + frame units: "9:16 portrait, 3s, 6 frames"', () => {
  const r = parseFormatReply('9:16 portrait, 3s, 6 frames');
  assert.equal(r?.aspect, '9:16 mobile portrait');
  assert.equal(r?.duration, '3');
  assert.equal(r?.frame_count, '6');
});

test('keyword-only aspect, no ratio: "square 5s"', () => {
  const r = parseFormatReply('square 5s');
  assert.equal(r?.aspect, '1:1 square');
  assert.equal(r?.duration, '5');
});

test('RedNote keyword maps to 4:5', () => {
  assert.equal(parseFormatReply('RedNote 10s 8 frames')?.aspect, '4:5 RedNote');
});

test('partial: just an aspect still counts', () => {
  assert.deepEqual(parseFormatReply('landscape'), { aspect: '16:9 landscape' });
});

test('does not treat duration "s" as a frame count', () => {
  const r = parseFormatReply('16:9 / 5s');
  assert.equal(r?.duration, '5');
  assert.equal(r?.frame_count, undefined);
});

test('long prose is content, not a format answer', () => {
  assert.equal(
    parseFormatReply('I want to make a video introducing our new product launch, focused on three core selling points and pricing'),
    undefined,
  );
});

test('unrelated short text yields no signal', () => {
  assert.equal(parseFormatReply('hello'), undefined);
  assert.equal(parseFormatReply('continue'), undefined);
});
