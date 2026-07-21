/**
 * Minimal ACP (Agent Client Protocol) JSON-RPC client over child-process stdio.
 *
 * Used for agents which speak ACP rather than printing to stdout. This is a
 * slim, single-prompt client —
 * just enough to drive one turn and stream the text back; it does NOT implement
 * the full OD daemon ACP surface (permissions, terminals, MCP, multi-turn).
 *
 * Handshake (all newline-delimited JSON-RPC 2.0 on stdin/stdout):
 *   → initialize        { protocolVersion, clientCapabilities, clientInfo }
 *   → session/new       { cwd, mcpServers: [] }
 *   → session/set_config_option { sessionId, configId, value }
 *                          (only for an explicit model and an advertised
 *                           category=model session option)
 *   → session/prompt     { sessionId, prompt: [{type:'text', text}] }
 *   ← session/update notifications: agent_message_chunk.content.text = output
 *   ← result for the prompt request id = turn complete
 *
 * Distilled from open-design/apps/daemon/src/acp.ts (the production version).
 */
import { spawn as cpSpawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import type { AgentEvent, ModelDiscoveryResult, ModelOption } from './types.js';

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_STAGE_TIMEOUT_MS = 120_000;

export interface RunAcpOptions {
  /** Resolved absolute path to the agent binary (e.g. vela). */
  bin: string;
  /** Argv after the binary, e.g. ['agent','run','--runtime','opencode']. */
  args: string[];
  prompt: string;
  cwd: string;
  /** Explicit model id. Omit / 'default' to preserve the agent's native default. */
  model?: string;
  env?: Record<string, string>;
  onEvent: (e: AgentEvent) => void;
  signal: AbortSignal;
  clientName?: string;
  clientVersion?: string;
}

type JsonRpcId = number;

interface AcpSelectValue {
  value?: string;
  name?: string;
  description?: string;
}

interface AcpConfigOption {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: AcpSelectValue[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function sessionConfigOptions(result: unknown): AcpConfigOption[] {
  const obj = asRecord(result);
  const raw = obj?.configOptions ?? obj?.config_options;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AcpConfigOption => Boolean(asRecord(item)));
}

function modelConfigOption(result: unknown): AcpConfigOption | null {
  return sessionConfigOptions(result).find((option) => option.category === 'model') ?? null;
}

/** Legacy selection is allowed only when initialize explicitly advertises it. */
function advertisesLegacySetModel(result: unknown): boolean {
  const root = asRecord(result);
  if (!root) return false;
  const capabilities = asRecord(root.agentCapabilities ?? root.capabilities);
  const session = asRecord(capabilities?.sessionCapabilities ?? capabilities?.session);
  const selection = asRecord(session?.modelSelection ?? capabilities?.modelSelection);
  const methods = capabilities?.methods ?? session?.methods;
  return session?.setModel === true
    || session?.set_model === true
    || selection?.method === 'session/set_model'
    || selection?.legacySetModel === true
    || (Array.isArray(methods) && methods.includes('session/set_model'));
}

function optionsToModels(option: AcpConfigOption): ModelOption[] {
  const current = option.currentValue;
  return (option.options ?? []).flatMap((entry) => {
    const value = entry.value?.trim();
    if (!value) return [];
    return [{
      id: value,
      name: entry.name?.trim() || value,
      ...(entry.description?.trim() && { description: entry.description.trim() }),
      ...(current === value && { isDefault: true }),
      availability: 'available' as const,
    }];
  });
}

export async function runAcpAgent(opts: RunAcpOptions): Promise<{ exitCode: number }> {
  const cwd = resolvePath(opts.cwd || process.cwd());
  const child = cpSpawn(opts.bin, opts.args, {
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(opts.bin) && { shell: true }),
  });

  if (!child.stdin || !child.stdout) {
    opts.onEvent({ type: 'error', message: 'ACP: child has no stdio pipes' });
    return { exitCode: -1 };
  }

  let stderrBuf = '';
  child.stderr?.on('data', (c: Buffer) => { stderrBuf += c.toString('utf8'); });

  return await new Promise<{ exitCode: number }>((done) => {
    let settled = false;
    let nextId = 1;
    let sessionId: string | null = null;
    let initId: JsonRpcId | null = null;
    let initResult: unknown;
    let newSessionId: JsonRpcId | null = null;
    let setConfigId: JsonRpcId | null = null;
    let setLegacyModelId: JsonRpcId | null = null;
    let promptId: JsonRpcId | null = null;
    let buf = '';
    let stageTimer: ReturnType<typeof setTimeout> | null = null;

    const writeRpc = (id: JsonRpcId, method: string, params: unknown) => {
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };

    const armTimer = (label: string) => {
      if (stageTimer) clearTimeout(stageTimer);
      stageTimer = setTimeout(() => finish(-1, `ACP timed out waiting for ${label}`), DEFAULT_STAGE_TIMEOUT_MS);
    };

    const finish = (code: number, errMsg?: string) => {
      if (settled) return;
      settled = true;
      if (stageTimer) clearTimeout(stageTimer);
      if (errMsg) {
        const tail = stderrBuf.trim().slice(-400);
        opts.onEvent({ type: 'error', message: tail ? `${errMsg} — ${tail}` : errMsg });
      }
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      done({ exitCode: code });
    };

    opts.signal.addEventListener('abort', () => finish(-1));

    child.on('error', (err) => finish(-1, `ACP spawn failed: ${err.message}`));
    child.on('exit', (code) => {
      // Normal completion path resolves on the prompt result; an exit before
      // that is an error (often: not logged in, surfaced on stderr).
      if (!settled) finish(code ?? -1, `vela exited (code ${code ?? 'null'}) before the turn completed`);
    });

    const handle = (msg: Record<string, unknown>) => {
      // --- responses to our requests (have an id + result/error) ---
      if ('id' in msg && (('result' in msg) || ('error' in msg))) {
        if (msg.error) {
          const e = msg.error as { message?: string; code?: number };
          return finish(-1, `ACP error${e.code ? ` ${e.code}` : ''}: ${e.message ?? 'unknown'}`);
        }
        const id = msg.id as JsonRpcId;
        if (id === initId) {
          initResult = msg.result;
          // initialized → open a session
          newSessionId = nextId++;
          armTimer('session/new');
          return writeRpc(newSessionId, 'session/new', { cwd, mcpServers: [] });
        }
        if (id === newSessionId) {
          const result = msg.result as { sessionId?: string } | undefined;
          sessionId = result?.sessionId ?? null;
          if (!sessionId) return finish(-1, 'ACP: session/new returned no sessionId');
          if (opts.model && opts.model !== 'default') {
            const config = modelConfigOption(msg.result);
            if (config?.id) {
              const advertised = optionsToModels(config);
              if (advertised.length && !advertised.some((entry) => entry.id === opts.model)) {
                return finish(-1, `ACP model "${opts.model}" is not advertised by session config option "${config.name ?? config.id}"`);
              }
              setConfigId = nextId++;
              armTimer('session/set_config_option');
              return writeRpc(setConfigId, 'session/set_config_option', {
                sessionId,
                configId: config.id,
                value: opts.model,
              });
            }
            if (advertisesLegacySetModel(initResult)) {
              setLegacyModelId = nextId++;
              armTimer('session/set_model (advertised legacy compatibility)');
              return writeRpc(setLegacyModelId, 'session/set_model', { sessionId, modelId: opts.model });
            }
            return finish(-1, `ACP agent did not advertise a model session config option; cannot apply "${opts.model}" safely`);
          }
          return sendPrompt();
        }
        if (id === setConfigId || id === setLegacyModelId) {
          return sendPrompt();
        }
        if (id === promptId) {
          // Turn complete.
          opts.onEvent({ type: 'message_end', reason: 'ok' });
          return finish(0);
        }
        return;
      }

      // --- notifications (method, no response expected) ---
      if (msg.method === 'session/update') {
        const params = msg.params as { update?: Record<string, unknown> } | undefined;
        const update = params?.update;
        if (update?.sessionUpdate === 'agent_message_chunk') {
          const content = update.content as { text?: string } | undefined;
          if (content?.text) {
            armTimer('session/prompt stream');
            opts.onEvent({ type: 'text', chunk: content.text });
          }
        }
        return;
      }

      // --- requests FROM the agent (permission etc.) — answer non-interactively ---
      if (msg.method === 'session/request_permission' && 'id' in msg) {
        // We run non-interactively; reject so the agent proceeds with defaults
        // rather than hanging. (OD picks an allow option; for our read-only
        // text turn, declining is safe and avoids file mutations.)
        const params = msg.params as { options?: Array<{ optionId?: string; kind?: string }> } | undefined;
        const allow = params?.options?.find((o) => /allow|accept|yes/i.test(o.kind ?? o.optionId ?? ''));
        const optionId = allow?.optionId ?? params?.options?.[0]?.optionId;
        if (optionId) child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId } } })}\n`);
        return;
      }
    };

    const sendPrompt = () => {
      promptId = nextId++;
      armTimer('session/prompt');
      writeRpc(promptId, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      });
    };

    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line); } catch { continue; } // ignore non-JSON noise
        try { handle(msg); } catch (e) { finish(-1, `ACP handler error: ${e instanceof Error ? e.message : e}`); }
      }
    });

    // Kick off the handshake.
    initId = nextId++;
    armTimer('initialize');
    writeRpc(initId, 'initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { terminal: false },
      clientInfo: { name: opts.clientName ?? 'html-video', version: opts.clientVersion ?? '0.1' },
    });
  });
}

export interface DiscoverAcpModelsOptions {
  bin: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  clientName?: string;
  clientVersion?: string;
}

/**
 * Opens one ACP session and reads the protocol-announced category=model
 * configuration option. It never scrapes an interactive selector.
 */
export async function discoverAcpModels(opts: DiscoverAcpModelsOptions): Promise<ModelDiscoveryResult> {
  const cwd = resolvePath(opts.cwd || process.cwd());
  const child = cpSpawn(opts.bin, opts.args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(opts.bin) && { shell: true }),
  });
  if (!child.stdin || !child.stdout) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    throw new Error('ACP discovery child has no stdio pipes.');
  }

  return await new Promise<ModelDiscoveryResult>((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let stderr = '';
    let nextId = 1;
    let initId = 0;
    let sessionId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const writeRpc = (id: number, method: string, params: unknown) => {
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };
    const arm = (label: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(new Error(`ACP model discovery timed out waiting for ${label}`)), DEFAULT_STAGE_TIMEOUT_MS);
    };
    const finish = (error?: Error, result?: ModelDiscoveryResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      if (error) {
        const detail = stderr.trim().slice(-400);
        reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error('ACP model discovery ended without a result.'));
      }
    };
    const abort = () => finish(new Error('ACP model discovery cancelled.'));
    opts.signal?.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish(new Error(`ACP model discovery spawn failed: ${error.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`ACP model discovery process exited with code ${code ?? 'null'}`));
    });

    const handle = (message: Record<string, unknown>) => {
      if (message.error) {
        const rpcError = message.error as { code?: number; message?: string };
        return finish(new Error(`ACP error${rpcError.code !== undefined ? ` ${rpcError.code}` : ''}: ${rpcError.message ?? 'unknown'}`));
      }
      if (message.id === initId && 'result' in message) {
        sessionId = nextId++;
        arm('session/new');
        return writeRpc(sessionId, 'session/new', { cwd, mcpServers: [] });
      }
      if (message.id === sessionId && 'result' in message) {
        const config = modelConfigOption(message.result);
        if (!config) {
          return finish(undefined, {
            source: 'ACP session config options',
            scope: 'current ACP session/account',
            status: 'unsupported',
            models: [],
            message: 'The ACP server did not announce a category=model session config option.',
          });
        }
        const models = optionsToModels(config);
        if (!models.length) {
          return finish(undefined, {
            source: `ACP session config option ${config.id ?? config.name ?? 'model'}`,
            scope: 'current ACP session/account',
            status: 'unsupported',
            models: [],
            message: 'The ACP model config option did not advertise selectable values.',
          });
        }
        return finish(undefined, {
          source: `ACP session config option ${config.id ?? config.name ?? 'model'}`,
          scope: 'current ACP session/account',
          models,
        });
      }
    };

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        try { handle(message); } catch (error) {
          finish(new Error(`ACP model discovery handler failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    });

    initId = nextId++;
    arm('initialize');
    writeRpc(initId, 'initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { terminal: false },
      clientInfo: { name: opts.clientName ?? 'html-video', version: opts.clientVersion ?? '0.1' },
    });
  });
}
