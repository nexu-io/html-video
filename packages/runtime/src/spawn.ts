import { spawn as cpSpawn } from 'node:child_process';
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

  const args = def.buildArgs(prompt, context);
  const env = { ...process.env, ...(def.env ?? {}) };

  const child = cpSpawn(def.bin, args, {
    cwd: context.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (def.promptViaStdin && child.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  let stdoutBuf = '';
  let stderrBuf = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
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
    stderrBuf += chunk.toString('utf8');
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

