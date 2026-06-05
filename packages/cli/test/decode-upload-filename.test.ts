import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUploadFilename } from '../dist/studio-server.js';

// Regression coverage for issue #9 (CJK attachment filename mojibake).
// The multipart body is read as a latin1 string, so a UTF-8 filename in the
// plain `filename="..."` form arrives with each byte as a latin1 char; we
// round-trip latin1->utf8 to restore it.

// Simulate what the latin1-read header carries for a UTF-8 filename: take the
// real name, encode to UTF-8 bytes, reinterpret those bytes as latin1 chars.
function asLatin1(realUtf8Name: string): string {
  return Buffer.from(realUtf8Name, 'utf8').toString('latin1');
}

test('plain filename: CJK name restored from latin1 bytes', () => {
  const real = '扑克流程简写语言小白教程.md';
  assert.equal(decodeUploadFilename(undefined, asLatin1(real)), real);
});

test('plain filename: mixed CJK + digits + ext', () => {
  const real = '局部截取_20260604_223241.png';
  assert.equal(decodeUploadFilename(undefined, asLatin1(real)), real);
});

test('plain ASCII filename is unchanged (round-trip is a no-op)', () => {
  assert.equal(decodeUploadFilename(undefined, 'report.csv'), 'report.csv');
});

test('RFC 5987 filename* wins and is percent-decoded', () => {
  const star = "UTF-8''" + encodeURIComponent('中文文件.md');
  assert.equal(decodeUploadFilename(star, 'fallback.md'), '中文文件.md');
});

test('RFC 5987 with language tag prefix', () => {
  const star = "UTF-8'zh-CN'" + encodeURIComponent('数据.json');
  assert.equal(decodeUploadFilename(star, undefined), '数据.json');
});

test('neither form present yields a safe default', () => {
  assert.equal(decodeUploadFilename(undefined, undefined), 'upload');
});
