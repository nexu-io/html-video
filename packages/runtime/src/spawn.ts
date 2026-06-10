import { spawn as cpSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
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

  // ---- CLI agents (claude / codex / gemini etc): spawn a child process ----
  // Resolving the real bin path is async on Windows (needs `where`), so the
  // child is created inside an async IIFE. We still return a synchronous
  // SpawnHandle: stop() goes through an AbortController, and `done` resolves
  // when the child closes (or fails to start).
  const args = def.buildArgs(prompt, context);
  const env = { ...process.env, ...(def.env ?? {}) };
  const isWin = process.platform === 'win32';

  const ac = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort());
  let childKill: (() => void) | null = null;
  ac.signal.addEventListener('abort', () => childKill?.());

  let stdoutBuf = '';
  let stderrBuf = '';

  // Decode through StringDecoder, not chunk.toString('utf8'): a multi-byte
  // UTF-8 character (e.g. any CJK glyph is 3 bytes) can straddle two `data`
  // chunks, and decoding each chunk independently turns the split bytes into
  // U+FFFD replacement chars (the "◆◆◆" mojibake in issue #9). StringDecoder
  // buffers an incomplete trailing sequence until the next chunk completes it.
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');

  const done = (async (): Promise<{ exitCode: number; signal: NodeJS.Signals | null }> => {
    // On Windows most CLI agents ship as a `.cmd` shim (e.g. claude.cmd).
    // Node's spawn() can't launch a batch file without a shell, and bare
    // `claude` (no .cmd) resolves to nothing → ENOENT (-4058). Resolve the
    // real path via `where` and run through a shell on win32. On POSIX the
    // bin name on PATH works directly, so keep the cheap path.
    let command = def.bin;
    if (isWin) {
      const { resolveBin } = await import('./detect.js');
      const resolved = await resolveBin(def);
      if (resolved) command = resolved;
    }

    const child = cpSpawn(command, args, {
      cwd: context.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(isWin && { shell: true }),
      windowsHide: true,
    });
    childKill = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    };
    if (ac.signal.aborted) childKill();

    if (def.promptViaStdin && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

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

    return await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((resolve) => {
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
        onEvent?.({ type: 'message_end', reason: 'error' });
        resolve({ exitCode: -1, signal: null });
      });
    });
  })();

  return {
    pid: 0,
    stop: () => ac.abort(),
    done,
  };
}

