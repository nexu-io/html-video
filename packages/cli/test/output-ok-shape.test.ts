import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setJsonMode, ok } from '../dist/output.js';

// Regression coverage for issue #57, finding 2: ok() spread whatever it got
// into the envelope, so a string payload produced `{status:'ok',0:'s',…}` and
// primitives/null silently vanished. Non-object payloads are now wrapped in
// `data`, keeping every `ok` line a well-formed JSON object.

function capture(fn: () => void): string {
  const lines: string[] = [];
  const prev = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(s);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = prev;
  }
  return lines.join('');
}

test('plain object payloads keep spreading at the top level (back-compat)', () => {
  setJsonMode(true);
  const out = capture(() => ok({ url: 'http://x', port: 1 }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.url, 'http://x');
  assert.equal(parsed.port, 1);
  assert.ok(!('data' in parsed));
});

test('string payloads are wrapped under data instead of exploding into chars', () => {
  setJsonMode(true);
  const parsed = JSON.parse(capture(() => ok('abc')));
  assert.deepEqual(parsed, { status: 'ok', data: 'abc' });
});

test('number, boolean, null, array payloads all produce clean envelopes', () => {
  setJsonMode(true);
  assert.deepEqual(JSON.parse(capture(() => ok(42))), { status: 'ok', data: 42 });
  assert.deepEqual(JSON.parse(capture(() => ok(true))), { status: 'ok', data: true });
  assert.deepEqual(JSON.parse(capture(() => ok(null))), { status: 'ok', data: null });
  assert.deepEqual(JSON.parse(capture(() => ok([1, 2]))), { status: 'ok', data: [1, 2] });
  // JSON.stringify drops undefined-valued keys, so undefined collapses to the
  // bare envelope — still a valid, predictable line.
  assert.deepEqual(JSON.parse(capture(() => ok(undefined))), { status: 'ok' });
});
