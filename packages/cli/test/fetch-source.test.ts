import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublicHttpUrl, extractUrls } from '../dist/fetch-source.js';

test('extractUrls keeps order, dedupes, trims trailing punctuation', () => {
  assert.deepEqual(
    extractUrls('see https://example.com/a, and https://example.com/b! also https://example.com/a'),
    ['https://example.com/a', 'https://example.com/b'],
  );
  assert.deepEqual(extractUrls('no links here'), []);
  assert.deepEqual(extractUrls('https://a.com https://b.com https://c.com https://d.com', 2), [
    'https://a.com',
    'https://b.com',
  ]);
});

test('assertPublicHttpUrl accepts ordinary https hosts', () => {
  const u = assertPublicHttpUrl('https://example.com/path?q=1');
  assert.equal(u.hostname, 'example.com');
  assert.equal(u.protocol, 'https:');
});

const REJECT = [
  ['http://localhost/secret', 'local host'],
  ['http://127.0.0.1/admin', 'private IP'],
  ['http://0.0.0.0/', 'local host'],
  ['http://[::1]/', 'local host'],
  ['http://foo.localhost/x', 'local host'],
  ['http://meta.internal/', 'local host'],
  ['http://printer.local/', 'local host'],
  ['http://10.0.0.5/', 'private IP'],
  ['http://192.168.1.1/', 'private IP'],
  ['http://172.16.0.1/', 'private IP'],
  ['http://172.31.255.255/', 'private IP'],
  ['http://169.254.169.254/latest/meta-data/', 'private IP'],
  ['file:///etc/passwd', 'only http'],
  ['ftp://example.com/x', 'only http'],
  ['not a url', 'invalid URL'],
];

test('assertPublicHttpUrl rejects SSRF targets', () => {
  for (const [url, needle] of REJECT) {
    assert.throws(
      () => assertPublicHttpUrl(url),
      (err: unknown) =>
        err instanceof Error && err.message.toLowerCase().includes(needle.toLowerCase()),
      `expected reject for ${url}`,
    );
  }
});

test('assertPublicHttpUrl allows non-private public-looking IPv4', () => {
  // 8.8.8.8 is public; 172.32.x is outside the 172.16–31 private band.
  assert.equal(assertPublicHttpUrl('https://8.8.8.8/').hostname, '8.8.8.8');
  assert.equal(assertPublicHttpUrl('http://172.32.0.1/').hostname, '172.32.0.1');
});
