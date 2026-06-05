import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnAgent } from '../dist/index.js';
import type { AgentDef } from '../dist/index.js';

// Regression coverage for issue #9 mojibake (◆◆◆): a multi-byte UTF-8 char
// split across two stdout `data` chunks must not become U+FFFD. spawn.ts now
// decodes through StringDecoder, which buffers an incomplete trailing sequence.

// A child that prints CJK text ONE BYTE AT A TIME with a tick between bytes, so
// every 3-byte glyph is guaranteed to straddle multiple `data` events.
const BYTE_AT_A_TIME = `
const s = Buffer.from('设计引擎：每次使用都是一次进化。', 'utf8');
let i = 0;
(function next() {
  if (i >= s.length) { process.exit(0); return; }
  process.stdout.write(Buffer.from([s[i++]]));
  setTimeout(next, 1);
})();
`;

function makeNodeDef(code: string): AgentDef {
  return {
    id: 'test-echo',
    name: 'test-echo',
    bin: process.execPath, // node
    versionArgs: ['--version'],
    buildArgs: () => ['-e', code],
    streamFormat: 'plain',
  };
}

test('CJK split across stdout chunks is not corrupted', async () => {
  let collected = '';
  const handle = spawnAgent({
    def: makeNodeDef(BYTE_AT_A_TIME),
    prompt: '',
    context: { cwd: process.cwd() },
    onEvent: (ev) => {
      if (ev.type === 'text') collected += ev.chunk;
    },
  });
  const { exitCode } = await handle.done;
  assert.equal(exitCode, 0);
  assert.equal(collected, '设计引擎：每次使用都是一次进化。');
  assert.ok(!collected.includes('�'), 'must contain no U+FFFD replacement chars');
});
