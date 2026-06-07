import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgent } from '../dist/index.js';
import type { AgentDef } from '../dist/index.js';

test(
  'Windows .cmd shims launch through spawnAgent',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hv-cmd-shim-'));
    const shim = join(dir, 'echo-agent.cmd');
    const script = join(dir, 'echo-agent.js');
    const node = process.execPath;
    await writeFile(script, 'process.stdin.pipe(process.stdout);\n', 'utf8');
    await writeFile(
      shim,
      `@echo off\r\n"${node}" "${script}"\r\n`,
      'utf8',
    );

    const def: AgentDef = {
      id: 'test-cmd-shim',
      name: 'test-cmd-shim',
      bin: shim,
      versionArgs: ['--version'],
      buildArgs: () => [],
      streamFormat: 'plain',
      promptViaStdin: true,
    };

    let collected = '';
    let error = '';
    try {
      const handle = spawnAgent({
        def,
        prompt: 'shim-ok',
        context: { cwd: dir },
        onEvent: (ev) => {
          if (ev.type === 'text') collected += ev.chunk;
          if (ev.type === 'error') error += ev.message;
        },
      });
      const { exitCode } = await handle.done;
      assert.equal(exitCode, 0, error);
      assert.equal(collected, 'shim-ok');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
