/**
 * Official, non-interactive model discovery.
 *
 * This module intentionally contains no product-owned model allow-list. A
 * catalog is returned only when the configured API or installed CLI exposes
 * one. Text parsers are conservative: an unfamiliar output degrades to an
 * unsupported/error catalog instead of presenting guessed model ids.
 */
import { spawn as cpSpawn } from 'node:child_process';
import type {
  AgentDef,
  ModelAvailability,
  ModelCatalog,
  ModelDiscoveryContext,
  ModelDiscoveryResult,
  ModelOption,
} from './types.js';

const COMMAND_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MS = 20_000;
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,199}$/;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function cleanText(value: string): string {
  return value.replace(ANSI_RE, '').replace(/\r/g, '');
}

export function isValidModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_RE.test(value.trim());
}

function normalizeModels(models: ModelOption[], defaultAvailability: ModelAvailability = 'available'): ModelOption[] {
  const seen = new Set<string>();
  const normalized: ModelOption[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!isValidModelId(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      name: model.name.trim() || id,
      ...(model.isDefault !== undefined && { isDefault: model.isDefault }),
      ...(model.description?.trim() && { description: model.description.trim() }),
      availability: model.availability ?? defaultAvailability,
    });
  }
  return normalized;
}

function commandError(label: string, result: CommandResult): Error {
  const detail = cleanText(result.stderr || result.stdout).trim().slice(-500);
  return new Error(`${label} exited with code ${result.code}${detail ? `: ${detail}` : ''}`);
}

async function runCommand(
  bin: string,
  args: string[],
  opts: { cwd: string; signal?: AbortSignal; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = cpSpawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...(process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin) && { shell: true }),
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      fn();
    };
    const abort = () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish(() => reject(new Error('model discovery cancelled')));
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish(() => reject(new Error(`model discovery timed out after ${opts.timeoutMs ?? COMMAND_TIMEOUT_MS}ms`)));
    }, opts.timeoutMs ?? COMMAND_TIMEOUT_MS);

    opts.signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
  });
}

function objectsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['data', 'models', 'items']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if (obj.result && typeof obj.result === 'object') return objectsFromPayload(obj.result);
  return [];
}

export function parseModelPayload(payload: unknown, availability: ModelAvailability = 'available'): ModelOption[] {
  const out: ModelOption[] = [];
  for (const item of objectsFromPayload(payload)) {
    if (isValidModelId(item)) {
      out.push({ id: item.trim(), name: item.trim(), availability });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const idValue = obj.id ?? obj.model ?? obj.value ?? obj.slug;
    if (!isValidModelId(idValue)) continue;
    const id = idValue.trim();
    const nameValue = obj.displayName ?? obj.display_name ?? obj.name ?? obj.title;
    const descriptionValue = obj.description ?? obj.summary;
    out.push({
      id,
      name: typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : id,
      ...(typeof obj.isDefault === 'boolean' && { isDefault: obj.isDefault }),
      ...(typeof obj.is_default === 'boolean' && { isDefault: obj.is_default }),
      ...(typeof descriptionValue === 'string' && descriptionValue.trim() && { description: descriptionValue.trim() }),
      availability,
    });
  }
  return normalizeModels(out, availability);
}

/** Conservative parser for CLI output where each model occupies one line. */
export function parseModelLines(
  raw: string,
  opts?: { availability?: ModelAvailability; allowTable?: boolean },
): ModelOption[] {
  const availability = opts?.availability ?? 'available';
  const result: ModelOption[] = [];
  for (const originalLine of cleanText(raw).split('\n')) {
    const line = originalLine.trim();
    if (!line) continue;

    const current = line.match(/^(?:current|default)(?:\s+model)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._:/+@-]*)\s*$/i);
    if (current?.[1] && isValidModelId(current[1])) {
      result.push({ id: current[1], name: current[1], isDefault: true, availability });
      continue;
    }

    const bullet = line.replace(/^(?:[-*•>]\s+|\d+[.)]\s+)/, '').trim();
    const tokenOnly = bullet.match(/^([A-Za-z0-9][A-Za-z0-9._:/+@-]*)(?:\s+\((?:current|default)\))?$/i);
    if (tokenOnly?.[1] && isValidModelId(tokenOnly[1]) && !tokenOnly[1].startsWith('--')) {
      result.push({
        id: tokenOnly[1],
        name: tokenOnly[1],
        ...(/\((?:current|default)\)/i.test(bullet) && { isDefault: true }),
        availability,
      });
      continue;
    }

    if (opts?.allowTable) {
      const columns = bullet.split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
      const first = columns[0];
      if (first && isValidModelId(first) && !/^(?:model|id|name|available)$/i.test(first)) {
        result.push({
          id: first,
          name: columns[1] || first,
          ...(columns.slice(1).some((part) => /\b(?:current|default)\b/i.test(part)) && { isDefault: true }),
          availability,
        });
      }
    }
  }
  return normalizeModels(result, availability);
}

function parseJsonOrLines(
  raw: string,
  availability: ModelAvailability,
  opts?: { allowTable?: boolean },
): ModelOption[] {
  const clean = cleanText(raw).trim();
  if (!clean) return [];
  try {
    const parsed = parseModelPayload(JSON.parse(clean), availability);
    if (parsed.length) return parsed;
  } catch {
    // Official CLIs often use a line-oriented text format instead of JSON.
  }
  return parseModelLines(clean, { availability, allowTable: opts?.allowTable });
}

export async function discoverAgentModels(
  def: AgentDef,
  ctx: ModelDiscoveryContext,
): Promise<ModelCatalog> {
  const fetchedAt = new Date().toISOString();
  if (!def.supportsModelSelection) {
    return {
      agentId: def.id,
      source: `${def.name} native default`,
      scope: 'native tool configuration',
      toolVersion: ctx.toolVersion,
      fetchedAt,
      status: 'unsupported',
      models: [],
      message: 'This adapter does not expose explicit model selection.',
    };
  }
  if (!def.discoverModels) {
    return {
      agentId: def.id,
      source: `${def.name}: no official headless catalog`,
      scope: 'Automatic or manually validated model id',
      toolVersion: ctx.toolVersion,
      fetchedAt,
      status: 'unsupported',
      models: [],
      message: 'The installed tool has no confirmed official non-interactive model catalog.',
    };
  }
  if (def.kind !== 'http' && !ctx.bin) {
    return {
      agentId: def.id,
      source: `${def.name} executable`,
      scope: 'installed tool',
      toolVersion: ctx.toolVersion,
      fetchedAt,
      status: 'unsupported',
      models: [],
      message: 'The agent is not installed, so its catalog cannot be queried.',
    };
  }
  try {
    const result = await def.discoverModels(ctx);
    return {
      agentId: def.id,
      source: result.source,
      scope: result.scope,
      toolVersion: ctx.toolVersion,
      fetchedAt,
      status: result.status ?? 'available',
      models: normalizeModels(result.models),
      ...(result.message && { message: result.message }),
    };
  } catch (error) {
    return {
      agentId: def.id,
      source: `${def.name} official discovery`,
      scope: def.kind === 'http' ? 'configured API host/account' : 'installed tool/account',
      toolVersion: ctx.toolVersion,
      fetchedAt,
      status: 'error',
      models: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function discoverAnthropicApiModels(_ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  const token = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
  if (!token) throw new Error('No ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is configured.');

  const base = new URL((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + '/');
  const endpoint = new URL(`${base.pathname.replace(/\/$/, '')}/v1/models`, base);
  if (endpoint.origin !== base.origin) throw new Error('Refusing model discovery on a different credential host.');
  const isOpenRouter = base.hostname === 'openrouter.ai' || base.hostname.endsWith('.openrouter.ai');
  const headers: Record<string, string> = isOpenRouter
    ? { authorization: `Bearer ${token}` }
    : {
        'x-api-key': token,
        authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
      };

  if (!isOpenRouter) endpoint.searchParams.set('limit', '1000');
  const discovered: ModelOption[] = [];
  let pageUrl: URL | null = endpoint;
  for (let page = 0; page < 20 && pageUrl; page += 1) {
    const response = await fetch(pageUrl, { headers, redirect: 'manual', signal: _ctx.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Model discovery refused an HTTP redirect from ${pageUrl.host}.`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }
    const payload = await response.json() as unknown;
    discovered.push(...parseModelPayload(payload, 'available'));
    const obj = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const lastId = typeof obj.last_id === 'string' ? obj.last_id : null;
    if (!isOpenRouter && obj.has_more === true && lastId) {
      const nextPage: URL = new URL(pageUrl.toString());
      nextPage.searchParams.set('after_id', lastId);
      pageUrl = nextPage;
    } else {
      pageUrl = null;
    }
  }
  const models = normalizeModels(discovered);
  if (!models.length) throw new Error('The official models endpoint returned no parseable model ids.');
  return {
    source: `${isOpenRouter ? 'OpenRouter' : 'Anthropic'} GET ${endpoint.pathname}`,
    scope: `${endpoint.host} account/API configuration`,
    models,
  };
}

interface RpcClient {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): void;
}

async function openJsonLineRpc(
  bin: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<RpcClient> {
  const child = cpSpawn(bin, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin) && { shell: true }),
  });
  if (!child.stdin || !child.stdout) throw new Error('JSON-RPC child has no stdio pipes.');

  let nextId = 1;
  let buffer = '';
  let stderr = '';
  let closed = false;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const rejectAll = (message: string) => {
    if (closed) return;
    closed = true;
    const detail = cleanText(stderr).trim().slice(-400);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(detail ? `${message}: ${detail}` : message));
    }
    pending.clear();
  };
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  child.on('error', (error) => rejectAll(`JSON-RPC spawn failed: ${error.message}`));
  child.on('exit', (code) => rejectAll(`JSON-RPC process exited with code ${code ?? 'null'}`));
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      if (typeof message.id !== 'number') continue;
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) {
        const rpcError = message.error as { code?: number; message?: string };
        item.reject(new Error(`JSON-RPC error${rpcError.code !== undefined ? ` ${rpcError.code}` : ''}: ${rpcError.message ?? 'unknown'}`));
      } else {
        item.resolve(message.result);
      }
    }
  });
  const abort = () => {
    rejectAll('JSON-RPC discovery cancelled');
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  };
  signal?.addEventListener('abort', abort, { once: true });

  return {
    request(method, params) {
      if (closed) return Promise.reject(new Error('JSON-RPC process is closed.'));
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`JSON-RPC timed out waiting for ${method}`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      if (!closed) child.stdin!.write(`${JSON.stringify({ method, params })}\n`);
    },
    close() {
      signal?.removeEventListener('abort', abort);
      closed = true;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('JSON-RPC discovery closed.'));
      }
      pending.clear();
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    },
  };
}

export async function discoverCodexModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  if (!ctx.bin) throw new Error('Codex executable was not resolved.');
  const rpc = await openJsonLineRpc(ctx.bin, ['app-server'], ctx.cwd, ctx.signal);
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'html-video', title: 'html-video Studio', version: '0.1' },
      capabilities: {},
    });
    rpc.notify('initialized');

    const models: ModelOption[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const result = await rpc.request('model/list', {
        ...(cursor && { cursor }),
        limit: 100,
      }) as Record<string, unknown> | undefined;
      models.push(...parseModelPayload(result, 'available'));
      const next = result?.nextCursor ?? result?.next_cursor;
      cursor = typeof next === 'string' && next ? next : null;
      if (!cursor) break;
    }
    const normalized = normalizeModels(models);
    if (!normalized.length) throw new Error('Codex model/list returned no parseable model ids.');
    return {
      source: 'codex app-server → model/list',
      scope: 'current Codex account and configuration',
      models: normalized,
    };
  } finally {
    rpc.close();
  }
}

async function discoverFromCommand(
  ctx: ModelDiscoveryContext,
  args: string[],
  source: string,
  scope: string,
  availability: ModelAvailability = 'available',
  opts?: { allowTable?: boolean },
): Promise<ModelDiscoveryResult> {
  if (!ctx.bin) throw new Error(`${ctx.agentId} executable was not resolved.`);
  const result = await runCommand(ctx.bin, args, { cwd: ctx.cwd, signal: ctx.signal });
  if (result.code !== 0) throw commandError(source, result);
  const models = parseJsonOrLines(result.stdout, availability, opts);
  if (!models.length) throw new Error(`${source} returned an unsupported or empty catalog format.`);
  return { source, scope, models };
}

export async function discoverGrokModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  if (!ctx.bin) throw new Error('Grok executable was not resolved.');
  const result = await runCommand(ctx.bin, ['models'], { cwd: ctx.cwd, signal: ctx.signal });
  if (result.code !== 0) throw commandError('grok models', result);
  const unauthenticated = /\bnot authenticated\b/i.test(cleanText(`${result.stdout}\n${result.stderr}`));
  const availability: ModelAvailability = unauthenticated ? 'known' : 'available';
  const models = parseJsonOrLines(result.stdout, availability, { allowTable: true });
  if (!models.length) throw new Error('grok models returned an unsupported or empty catalog format.');
  return {
    source: 'grok models',
    scope: unauthenticated
      ? 'models known by the installed CLI; account entitlement is not verified'
      : 'current authenticated Grok account',
    models,
    ...(unauthenticated && { message: 'Grok reports that the CLI is not authenticated; use Test after signing in.' }),
  };
}

export async function discoverCursorModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  if (!ctx.bin) throw new Error('Cursor Agent executable was not resolved.');
  const attempts: Array<{ args: string[]; source: string }> = [
    { args: ['models'], source: 'agent models' },
    { args: ['--list-models'], source: 'agent --list-models' },
  ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await discoverFromCommand(
        ctx,
        attempt.args,
        attempt.source,
        'current authenticated Cursor account',
        'available',
        { allowTable: true },
      );
      return result;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Installed Cursor CLI exposes no compatible official model listing: ${failures.join(' | ')}`);
}

export async function discoverOpenCodeModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  return await discoverFromCommand(
    ctx,
    ['models', '--refresh'],
    'opencode models --refresh',
    'providers configured in OpenCode',
    'available',
    { allowTable: true },
  );
}

export async function discoverAiderModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  return await discoverFromCommand(
    ctx,
    ['--list-models'],
    'aider --list-models',
    'models known by the installed Aider registry; entitlement is not confirmed',
    'known',
    { allowTable: true },
  );
}

export function parseCopilotHelpModels(raw: string): ModelOption[] {
  const lines = cleanText(raw).split('\n');
  const candidates: ModelOption[] = [];
  let inModelSection = false;
  let remaining = 0;
  for (const original of lines) {
    const line = original.trim();
    if (/^(?:-m,\s*)?--model\b/i.test(line) || /\bmodel\s+(?:choices|values|options)\s*:/i.test(line)) {
      inModelSection = true;
      remaining = 12;
    } else if (inModelSection) {
      remaining -= 1;
      if (remaining < 0 || (/^--[a-z]/i.test(line) && !/^--model\b/i.test(line))) inModelSection = false;
    }
    if (!inModelSection) continue;

    const valueBlock = line.match(/(?:choices|values|options)\s*:\s*\[?([^\]]+)\]?/i)?.[1];
    if (valueBlock) {
      for (const token of valueBlock.split(/[,|]/).map((part) => part.trim().replace(/^['"]|['"]$/g, ''))) {
        if (isValidModelId(token)) candidates.push({ id: token, name: token, availability: 'available' });
      }
      continue;
    }
    const parsed = parseModelLines(line, { availability: 'available', allowTable: true });
    candidates.push(...parsed);
  }
  return normalizeModels(candidates);
}

export async function discoverCopilotModels(ctx: ModelDiscoveryContext): Promise<ModelDiscoveryResult> {
  if (!ctx.bin) throw new Error('GitHub Copilot executable was not resolved.');
  const result = await runCommand(ctx.bin, ['help'], { cwd: ctx.cwd, signal: ctx.signal });
  if (result.code !== 0) throw commandError('copilot help', result);
  const models = parseCopilotHelpModels(`${result.stdout}\n${result.stderr}`);
  if (!models.length) throw new Error('copilot help did not expose a compatible official model list.');
  return {
    source: 'copilot help',
    scope: 'models advertised by the installed Copilot CLI; invoke Test to confirm entitlement',
    models,
  };
}
