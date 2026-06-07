import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

test(
  'Windows npm .cmd shims with %~dp0 parent paths preserve percent argv',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hv-npm-parent-cmd-shim-'));
    const binDir = join(dir, 'bin');
    const shim = join(binDir, 'argv-agent.cmd');
    const packageDir = join(dir, 'node_modules', 'argv-agent', 'bin');
    const script = join(packageDir, 'argv-agent.js');
    await mkdir(packageDir, { recursive: true });
    await mkdir(dirname(shim), { recursive: true });
    await writeFile(
      script,
      'console.log(JSON.stringify(process.argv.slice(2)));\n',
      'utf8',
    );
    await writeFile(
      shim,
      [
        '@ECHO off',
        'SETLOCAL',
        'endLocal & node "%~dp0\\..\\node_modules\\argv-agent\\bin\\argv-agent.js" %*',
        '',
      ].join('\r\n'),
      'utf8',
    );

    const argv = ['%USERPROFILE%', '100% done'];
    const def: AgentDef = {
      id: 'test-npm-parent-cmd-shim',
      name: 'test-npm-parent-cmd-shim',
      bin: shim,
      versionArgs: ['--version'],
      buildArgs: () => argv,
      streamFormat: 'plain',
    };

    let collected = '';
    let error = '';
    try {
      const handle = spawnAgent({
        def,
        prompt: '',
        context: { cwd: dir },
        onEvent: (ev) => {
          if (ev.type === 'text') collected += ev.chunk;
          if (ev.type === 'error') error += ev.message;
        },
      });
      const { exitCode } = await handle.done;
      assert.equal(exitCode, 0, error);
      assert.deepEqual(JSON.parse(collected), argv);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'Windows npm .cmd shims preserve percent argv through spawnAgent',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hv-npm-cmd-shim-'));
    const shim = join(dir, 'argv-agent.cmd');
    const packageDir = join(dir, 'node_modules', 'argv-agent', 'bin');
    const script = join(packageDir, 'argv-agent.js');
    const node = process.execPath;
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      script,
      'console.log(JSON.stringify(process.argv.slice(2)));\n',
      'utf8',
    );
    await writeFile(
      shim,
      [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        '',
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ') ELSE (',
        '  SET "_prog=node"',
        '  SET PATHEXT=%PATHEXT:;.JS;=;%',
        ')',
        '',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\argv-agent\\bin\\argv-agent.js" %*',
        '',
      ].join('\r\n'),
      'utf8',
    );

    const argv = ['%USERPROFILE%', '100% done', 'bang!'];
    const def: AgentDef = {
      id: 'test-npm-cmd-shim',
      name: 'test-npm-cmd-shim',
      bin: shim,
      versionArgs: ['--version'],
      buildArgs: () => argv,
      streamFormat: 'plain',
    };

    let collected = '';
    let error = '';
    try {
      const handle = spawnAgent({
        def,
        prompt: '',
        context: { cwd: dir },
        onEvent: (ev) => {
          if (ev.type === 'text') collected += ev.chunk;
          if (ev.type === 'error') error += ev.message;
        },
      });
      const { exitCode } = await handle.done;
      assert.equal(exitCode, 0, error);
      assert.deepEqual(JSON.parse(collected), argv);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
