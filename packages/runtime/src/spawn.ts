import { spawn as cpSpawn } from 'node:child_process';
import { extname } from 'node:path';
import type { AgentDef, AgentEvent, AgentInvokeContext, SpawnHandle } from './types.js';

function quoteCmdArg(arg: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnTarget(bin: string, args: string[]): { bin: string; args: string[] } {
  const ext = extname(bin).toLowerCase();
  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(ext)) {
    return {
      bin: 'cmd.exe',
      args: ['/d', '/s', '/c', [bin, ...args].map(quoteCmdArg).join(' ')],
    };
  }
  return { bin, args };
}

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

  let child: ReturnType<typeof cpSpawn> | null = null;
  const done = (async () => {
    const { resolveBin } = await import('./detect.js');
    const bin = await resolveBin(def);
    if (!bin) {
      onEvent?.({ type: 'error', message: `${def.name}: binary "${def.bin}" not found` });
      onEvent?.({ type: 'message_end', reason: 'error' });
      return { exitCode: -1, signal: null as NodeJS.Signals | null };
    }

    const args = def.buildArgs(prompt, context);
    const env = { ...process.env, ...(def.env ?? {}) };
    const target = spawnTarget(bin, args);

    child = cpSpawn(target.bin, target.args, {
      cwd: context.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (def.promptViaStdin && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
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
      stderrBuf += chunk.toString('utf8');
    });

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        try {
          child?.kill('SIGTERM');
        } catch {
          // ignore
        }
      });
    }

    return await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((resolve) => {
      child?.on('close', (code, signal) => {
        if (code !== 0) {
          onEvent?.({
            type: 'error',
            message: `agent exit code ${code}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`,
          });
        }
        onEvent?.({ type: 'message_end', reason: code === 0 ? 'ok' : 'error' });
        resolve({ exitCode: code ?? 0, signal });
      });
      child?.on('error', (err) => {
        onEvent?.({ type: 'error', message: err.message });
        resolve({ exitCode: -1, signal: null });
      });
    });
  })();

  return {
    pid: 0,
    stop: () => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    done,
  };
}

