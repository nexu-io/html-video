import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFormatReply } from '../dist/studio-server.js';

// Regression coverage for issue #2: a typed free-text format answer (when the
// model asked in prose instead of rendering the hv-form card) must parse into
// the same {aspect, duration, frame_count} shape a card submit produces, so the
// flow advances to confirm instead of re-asking.

test('the exact issue #2 reply: "16:9 横屏 / 5s / 10"', () => {
  const r = parseFormatReply('16:9 横屏 / 5s / 10');
  assert.equal(r?.aspect, '16:9 横屏');
  assert.equal(r?.duration, '5');
  assert.equal(r?.frame_count, '10');
});

test('chinese commas + 秒/帧 units: "9:16 竖屏，3秒，6帧"', () => {
  const r = parseFormatReply('9:16 竖屏，3秒，6帧');
  assert.equal(r?.aspect, '9:16 手机竖屏');
  assert.equal(r?.duration, '3');
  assert.equal(r?.frame_count, '6');
});

test('keyword-only aspect, no ratio: "方形 5s"', () => {
  const r = parseFormatReply('方形 5s');
  assert.equal(r?.aspect, '1:1 方形');
  assert.equal(r?.duration, '5');
});

test('xiaohongshu keyword maps to 4:5', () => {
  assert.equal(parseFormatReply('小红书 10秒 8帧')?.aspect, '4:5 小红书');
});

test('partial: just an aspect still counts', () => {
  assert.deepEqual(parseFormatReply('横屏'), { aspect: '16:9 横屏' });
});

test('does not treat duration "s" as a frame count', () => {
  const r = parseFormatReply('16:9 / 5s');
  assert.equal(r?.duration, '5');
  assert.equal(r?.frame_count, undefined);
});

test('long prose is content, not a format answer', () => {
  assert.equal(
    parseFormatReply('我想做一个介绍我们公司新产品发布的视频，重点讲三个核心卖点和定价'),
    undefined,
  );
});

test('unrelated short text yields no signal', () => {
  assert.equal(parseFormatReply('你好'), undefined);
  assert.equal(parseFormatReply('继续'), undefined);
});
