import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinProjects } from '../dist/studio-server.js';

// The /asset route guards on the resolved path containing
// `.html-video/projects/`. resolve() uses the platform separator, so on
// Windows the resolved path has backslashes; the guard must normalize them or
// it 403s every legitimate Windows asset path.

test('accepts a POSIX path inside .html-video/projects', () => {
  assert.equal(isWithinProjects('/home/u/.html-video/projects/p/assets/x.png'), true);
});

test('accepts a Windows path inside .html-video/projects', () => {
  assert.equal(isWithinProjects('C:\\Users\\u\\.html-video\\projects\\p\\assets\\x.png'), true);
});

test('rejects a path outside the projects tree (POSIX)', () => {
  assert.equal(isWithinProjects('/etc/passwd'), false);
});

test('rejects a path outside the projects tree (Windows)', () => {
  assert.equal(isWithinProjects('C:\\Windows\\System32\\config\\SAM'), false);
});
