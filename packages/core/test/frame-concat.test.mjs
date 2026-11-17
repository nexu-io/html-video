import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConcatFfmpegPlan, needsConcatReencode } from '../dist/frame-concat.js';

test('needsConcatReencode is true only when engines differ', () => {
  assert.equal(needsConcatReencode(['hyperframes', 'hyperframes']), false);
  assert.equal(needsConcatReencode(['remotion']), false);
  assert.equal(needsConcatReencode(['hyperframes', 'remotion']), true);
  assert.equal(needsConcatReencode(new Set(['hyperframes', 'remotion', 'hyperframes'])), true);
});

test('same-engine plan uses concat demuxer + stream copy', () => {
  const plan = buildConcatFfmpegPlan(
    ['/tmp/a.mp4', '/tmp/b.mp4'],
    '/tmp/out.mp4',
    '/tmp/concat.txt',
    { reencode: false },
  );
  assert.equal(plan.needsListFile, true);
  assert.equal(plan.listContents, "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'");
  assert.deepEqual(plan.args, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    '/tmp/concat.txt',
    '-c',
    'copy',
    '/tmp/out.mp4',
  ]);
  assert.equal(plan.args.includes('-filter_complex'), false);
});

test('mixed-engine plan uses concat FILTER (rebuilds PTS)', () => {
  const plan = buildConcatFfmpegPlan(
    ['/tmp/hf.mp4', '/tmp/rm.mp4', '/tmp/hf2.mp4'],
    '/tmp/out.mp4',
    '/tmp/concat.txt',
    { reencode: true, fps: 30 },
  );
  assert.equal(plan.needsListFile, false);
  assert.equal(plan.args.includes('-filter_complex'), true);
  const filterIdx = plan.args.indexOf('-filter_complex');
  assert.equal(plan.args[filterIdx + 1], '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]');
  assert.ok(plan.args.includes('libx264'));
  assert.equal(plan.args[plan.args.indexOf('-r') + 1], '30');
  // Independent -i per segment — not a concat demuxer list.
  assert.equal(plan.args.filter((a) => a === '-i').length, 3);
  assert.equal(plan.args.includes('-f'), false);
});

test('paths with single quotes are escaped in demuxer list', () => {
  const plan = buildConcatFfmpegPlan(["/tmp/o'brian.mp4"], '/tmp/out.mp4', '/tmp/concat.txt');
  assert.equal(plan.listContents, "file '/tmp/o'\\''brian.mp4'");
});

test('empty frame list throws', () => {
  assert.throws(() => buildConcatFfmpegPlan([], '/tmp/out.mp4', '/tmp/list.txt'));
});
