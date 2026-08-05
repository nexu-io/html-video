import assert from 'node:assert/strict';
// Unit tests for neutralizeBlockingResources — the render-blocking-stylesheet
// guard that fixed the all-black Remotion render (external Google Fonts <link>
// kept the srcdoc iframe from painting in headless chromium). See
// notes/2026-06-06-remotion-adapter-verify.md.
import { test } from 'node:test';
import { neutralizeBlockingResources } from '../dist/render.js';

test('async-loads an external Google Fonts stylesheet link', () => {
  const html = `<head><link href="https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap" rel="stylesheet" /></head>`;
  const out = neutralizeBlockingResources(html);
  assert.match(out, /media="print"/);
  assert.match(out, /onload="this\.media='all'"/);
  // still references the font so it applies if it loads in time
  assert.match(out, /fonts\.googleapis\.com/);
});

test('handles rel before href, single quotes, no self-closing slash', () => {
  const html = `<link rel='stylesheet' href='https://cdn.example.com/x.css'>`;
  const out = neutralizeBlockingResources(html);
  assert.match(out, /media="print"/);
});

test('handles protocol-relative external links', () => {
  const html = `<link rel="stylesheet" href="//cdn.example.com/a.css">`;
  const out = neutralizeBlockingResources(html);
  assert.match(out, /media="print"/);
});

test('leaves relative / same-document stylesheet links untouched', () => {
  const html = `<link rel="stylesheet" href="./local.css">`;
  assert.equal(neutralizeBlockingResources(html), html);
});

test('leaves inline <style> untouched', () => {
  const html = '<style>@import url(https://fonts.googleapis.com/x);body{color:red}</style>';
  assert.equal(neutralizeBlockingResources(html), html);
});

test('does not double-process a link that already declares media', () => {
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/x" media="screen">`;
  assert.equal(neutralizeBlockingResources(html), html);
});

test('neutralizes every external stylesheet in a multi-link head', () => {
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/a">
<link rel="stylesheet" href="https://use.typekit.net/b.css">
<link rel="stylesheet" href="/local.css">`;
  const out = neutralizeBlockingResources(html);
  assert.equal((out.match(/media="print"/g) ?? []).length, 2);
  assert.match(out, /href="\/local\.css"/); // local one unchanged
});

test('is a no-op for HTML with no stylesheet links', () => {
  const html = '<!doctype html><html><body><h1>hi</h1></body></html>';
  assert.equal(neutralizeBlockingResources(html), html);
});
