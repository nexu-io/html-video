import { spawn as cpSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { resolveCommandSync } from './detect.js';
import type { AgentDef, AgentEvent, AgentInvokeContext, SpawnHandle } from './types.js';

/**
 * Spawn an agent CLI and stream events to the listener.
 * v0.1: only supports streamFormat='plain' fully (chunks emitted as text events).
 *       claude-stream / json-event-stream are scaffolded but yield to plain for now.
 */
export interface SpawnOptions {
  def: AgentDef;
  prompt: string;
  context: AgentInvokeContext;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export function spawnAgent(opts: SpawnOptions): SpawnHandle {
  const { def, prompt, context, onEvent } = opts;

  // ---- http agents (anthropic-api etc): no child process, just fetch ----
  if (def.kind === 'http' && def.httpHandler) {
    const ac = new AbortController();
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => ac.abort());
    }
    const done = def.httpHandler(prompt, context, (ev) => onEvent?.(ev), ac.signal)
      .then(({ exitCode }) => {
        onEvent?.({ type: 'message_end', reason: exitCode === 0 ? 'ok' : 'error' });
        return { exitCode, signal: null as NodeJS.Signals | null };
      })
      .catch((err: Error) => {
        onEvent?.({ type: 'error', message: err.message });
        onEvent?.({ type: 'message_end', reason: 'error' });
        return { exitCode: -1, signal: null as NodeJS.Signals | null };
      });
    return {
      pid: 0,
      stop: () => ac.abort(),
      done,
    };
  }

  // ---- ACP agents (AMR / vela): bidirectional JSON-RPC over stdio ----
  if (def.streamFormat === 'acp-json-rpc') {
    const ac = new AbortController();
    if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort());
    const done = (async () => {
      const { resolveBin } = await import('./detect.js');
      const { runAcpAgent } = await import('./acp-client.js');
      const bin = await resolveBin(def);
      if (!bin) {
        onEvent?.({ type: 'error', message: `${def.name}: binary "${def.bin}" not found` });
        onEvent?.({ type: 'message_end', reason: 'error' });
        return { exitCode: -1, signal: null as NodeJS.Signals | null };
      }
      const { exitCode } = await runAcpAgent({
        bin,
        args: def.buildArgs(prompt, context),
        prompt,
        cwd: context.cwd,
        ...((context.model || def.defaultModel) && { model: context.model || def.defaultModel }),
        ...(def.env && { env: def.env }),
        onEvent: (ev) => onEvent?.(ev),
        signal: ac.signal,
      });
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return { pid: 0, stop: () => ac.abort(), done };
  }

  const args = def.buildArgs(prompt, context);
  const env = { ...process.env, ...(def.env ?? {}) };
  const bin = resolveCommandSync(def.bin) ?? def.bin;
  const command = commandForSpawn(bin, args);

  const child = cpSpawn(command.bin, command.args, {
    cwd: context.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(command.windowsVerbatimArguments !== undefined && {
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    }),
  });

  if (def.promptViaStdin && child.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  let stdoutBuf = '';
  let stderrBuf = '';

  // Decode through StringDecoder, not chunk.toString('utf8'): a multi-byte
  // UTF-8 character (e.g. any CJK glyph is 3 bytes) can straddle two `data`
  // chunks, and decoding each chunk independently turns the split bytes into
  // U+FFFD replacement chars (the "◆◆◆" mojibake in issue #9). StringDecoder
  // buffers an incomplete trailing sequence until the next chunk completes it.
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = outDecoder.write(chunk);
    if (!text) return;
    stdoutBuf += text;
    if (def.streamFormat === 'plain') {
      onEvent?.({ type: 'text', chunk: text });
    } else if (def.streamFormat === 'claude-stream' || def.streamFormat === 'json-event-stream') {
      // v0.2 hook: parse NDJSON and emit structured events
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj === 'object' && obj && 'type' in obj) {
            // claude stream-json events have richer shape; treat unknown as text
            onEvent?.({ type: 'text', chunk: JSON.stringify(obj) + '\n' });
          }
        } catch {
          onEvent?.({ type: 'text', chunk: line + '\n' });
        }
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += errDecoder.write(chunk);
  });

  if (opts.signal) {
    opts.signal.addEventListener('abort', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    });
  }

  const done = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (code, signal) => {
      // Flush any bytes the decoders were still holding (an incomplete trailing
      // multi-byte sequence). Normally empty on a clean exit.
      const outTail = outDecoder.end();
      if (outTail) {
        stdoutBuf += outTail;
        if (def.streamFormat === 'plain') onEvent?.({ type: 'text', chunk: outTail });
      }
      stderrBuf += errDecoder.end();
      if (code !== 0) {
        onEvent?.({
          type: 'error',
          message: `agent exit code ${code}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`,
        });
      }
      onEvent?.({ type: 'message_end', reason: code === 0 ? 'ok' : 'error' });
      resolve({ exitCode: code ?? 0, signal });
    });
    child.on('error', (err) => {
      onEvent?.({ type: 'error', message: err.message });
      resolve({ exitCode: -1, signal: null });
    });
  });

  return {
    pid: child.pid ?? 0,
    stop: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    done,
  };
}

function commandForSpawn(
  bin: string,
  args: string[],
): { bin: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform() !== 'win32' || !/\.(?:cmd|bat)$/i.test(bin)) {
    return { bin, args };
  }

  const npmShim = commandForNpmShim(bin, args);
  if (npmShim) return npmShim;

  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandLine = ['call', quoteCmdArg(bin), ...args.map(quoteCmdArg)].join(' ');
  return {
    bin: comspec,
    args: ['/d', '/c', commandLine],
    windowsVerbatimArguments: true,
  };
}

function commandForNpmShim(
  bin: string,
  args: string[],
): { bin: string; args: string[] } | null {
  let text: string;
  try {
    text = readFileSync(bin, 'utf8');
  } catch {
    return null;
  }

  const shimDir = dirname(bin);
  const scriptPath = resolveNpmShimScript(text, shimDir);
  if (!scriptPath || !existsSync(scriptPath)) return null;

  const bundledNode = join(shimDir, 'node.exe');
  const nodeBin = existsSync(bundledNode) ? bundledNode : (resolveCommandSync('node') ?? 'node');
  return { bin: nodeBin, args: [scriptPath, ...args] };
}

function resolveNpmShimScript(text: string, shimDir: string): string | null {
  const dp0Vars = new Map<string, string>();
  const setDp0Re = /^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*%~dp0\s*$/gim;
  for (const match of text.matchAll(setDp0Re)) {
    if (match[1]) dp0Vars.set(match[1].toLowerCase(), shimDir);
  }

  const dp0ExecRe = /"%~dp0\\?([^"]*?node_modules\\[^"]+)"\s+%\*/gi;
  for (const match of text.matchAll(dp0ExecRe)) {
    if (match[1]) return normalize(join(shimDir, match[1]));
  }

  const varExecRe = /"%([A-Za-z_][A-Za-z0-9_]*)%\\?([^"]*?node_modules\\[^"]+)"\s+%\*/gi;
  for (const match of text.matchAll(varExecRe)) {
    const base = match[1] ? dp0Vars.get(match[1].toLowerCase()) : undefined;
    const relative = match[2];
    if (!base || !relative) continue;
    return normalize(join(base, relative));
  }
  return null;
}

function quoteCmdArg(arg: string): string {
  if (arg.length === 0) return '""';
  return `"${arg.replace(/"/g, '""')}"`;
}

