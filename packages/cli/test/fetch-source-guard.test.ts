import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, assertPublicHttpUrl, fetchSource } from '../dist/fetch-source.js';

// Regression coverage for issue #57, finding 1: assertPublicHttpUrl checked
// `host === '::1'` against a hostname that URL keeps bracketed ("[::1]"), so
// the check was dead code and every bracketed IPv6 literal — including
// loopback and IPv4-mapped private addresses — sailed through the SSRF guard.

const rejects = (url: string) => {
  assert.throws(() => assertPublicHttpUrl(url), /refusing to fetch|invalid URL|only http/, url);
};

const accepts = (url: string) => {
  const u = assertPublicHttpUrl(url);
  assert.ok(u instanceof URL, url);
};

test('IPv4 private ranges are still rejected', () => {
  rejects('http://127.0.0.1/');
  rejects('http://10.1.2.3/');
  rejects('http://172.16.0.9/');
  rejects('http://192.168.1.1/');
  rejects('http://169.254.169.254/latest/meta-data/'); // cloud metadata
  rejects('http://0.0.0.0/');
  rejects('http://100.64.1.1/'); // CGNAT
});

test('bracketed IPv6 loopback / link-local / ULA are rejected (the actual bug)', () => {
  rejects('http://[::1]/');
  rejects('http://[::]/');
  rejects('http://[fe80::1]/');
  rejects('http://[fd00:dead:beef::1]/');
  rejects('http://[fc00::1]/');
});

test('IPv4-mapped IPv6 is rejected via the embedded v4 rules', () => {
  rejects('http://[::ffff:127.0.0.1]/');
  rejects('http://[::ffff:10.0.0.5]/');
  rejects('http://[::ffff:192.168.0.1]/');
});

test('public hosts still pass', () => {
  accepts('https://github.com/nexu-io/html-video');
  accepts('http://example.com/article');
  accepts('http://[2606:4c00::1]/'); // public IPv6
  accepts('http://[2001:db8::1234]/');
});

test('non-http schemes are rejected', () => {
  rejects('file:///etc/passwd');
  rejects('ftp://example.com/');
});

test('extractUrls trims trailing punctuation and skips closing delimiters', () => {
  assert.deepEqual(extractUrls('visit https://example.com/a, then https://example.com/b.'), [
    'https://example.com/a',
    'https://example.com/b',
  ]);
  assert.deepEqual(extractUrls('(see https://example.com/path?q=1)'), [
    'https://example.com/path?q=1',
  ]);
  assert.deepEqual(extractUrls('[https://example.com/x]'), ['https://example.com/x']);
  assert.deepEqual(extractUrls('no links here'), []);
});

test('a redirect to a private address is refused (hop-level SSRF guard)', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    })) as typeof fetch;
  try {
    await assert.rejects(
      fetchSource('https://attacker.example/jump'),
      /refusing to fetch private IP/,
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test('a redirect to a public address is followed', async () => {
  const prev = globalThis.fetch;
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, {
        status: 301,
        headers: { location: 'https://final.example/page' },
      });
    }
    return new Response('<html><title>moved</title><body>ok</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;
  globalThis.fetch = fakeFetch;
  try {
    const out = await fetchSource('https://start.example/a');
    assert.equal(calls.length, 2);
    assert.equal(out.kind, 'article');
    assert.match(out.markdown, /moved/);
  } finally {
    globalThis.fetch = prev;
  }
});
