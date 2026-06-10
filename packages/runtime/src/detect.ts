import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { promisify } from 'node:util';
import { AGENT_DEFS } from './registry.js';
import type { AgentDef, DetectedAgent } from './types.js';

const exec = promisify(execFile);

// Windows has no `which`; it ships `where.exe`. POSIX shells have `which`.
// `where` can emit multiple lines (one per PATHEXT match) — take the first.
const WHICH_CMD = process.platform === 'win32' ? 'where' : 'which';

async function which(bin: string): Promise<string | null> {
  try {
    // 8s, not 2s: detectAll() probes ~13 agents with Promise.all, so a dozen
    // `where`/`which` processes spawn at once. Under that contention a single
    // lookup can take several seconds on Windows; a tight 2s timeout would
    // spuriously mark an installed agent (claude/codex) unavailable, which then
    // makes the studio fall back to the API-key-only anthropic-api agent.
    const { stdout } = await exec(WHICH_CMD, [bin], { timeout: 8000 });
    const first = stdout.trim().split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

/** PATH → static binFallbacks → async resolveBinFallback (e.g. bundled npm pkg). */
export async function resolveBin(def: AgentDef): Promise<string | null> {
  const onPath = await which(def.bin);
  if (onPath) return onPath;
  for (const candidate of def.binFallbacks ?? []) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* not there / not executable — try next */
    }
  }
  if (def.resolveBinFallback) {
    try {
      const resolved = await def.resolveBinFallback();
      if (resolved) {
        accessSync(resolved, constants.X_OK);
        return resolved;
      }
    } catch {
      /* resolver threw or path not runnable — treat as not found */
    }
  }
  return null;
}

async function probeVersion(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(bin, args, { timeout: 5000 });
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

export async function detectOne(def: AgentDef): Promise<DetectedAgent> {
  // ---- HTTP agents (anthropic-api etc) ----
  if (def.kind === 'http') {
    const probe = def.httpProbe ? await def.httpProbe() : { available: false };
    return {
      id: def.id,
      name: def.name,
      bin: def.bin,
      available: probe.available,
      ...(probe.version !== undefined && { version: probe.version }),
      ...(def.installUrl !== undefined && { installUrl: def.installUrl }),
    };
  }
  const path = await resolveBin(def);
  if (!path) {
    return {
      id: def.id,
      name: def.name,
      bin: def.bin,
      available: false,
      ...(def.installUrl !== undefined && { installUrl: def.installUrl }),
    };
  }
  let version = await probeVersion(path, def.versionArgs);
  // Found on disk — but some agents need a further gate (e.g. AMR login state).
  if (def.extraDetect) {
    const extra = await def.extraDetect(path);
    if (extra.version !== undefined && extra.version !== null) version = extra.version;
    return {
      id: def.id,
      name: def.name,
      bin: def.bin,
      available: extra.available,
      path,
      version,
      ...(extra.hint !== undefined && { hint: extra.hint }),
      ...(def.installUrl !== undefined && { installUrl: def.installUrl }),
    };
  }
  return {
    id: def.id,
    name: def.name,
    bin: def.bin,
    available: true,
    path,
    version,
    ...(def.installUrl !== undefined && { installUrl: def.installUrl }),
  };
}

// In-process cache. Agent install state doesn't change inside one server
// run, so spawning `which` + `<bin> --version` on every /api/agents request
// (~400ms total for two agents) is wasted latency that blocks the studio
// composer on first paint. TTL guards against the rare "user installed mid-
// session" case.
const DETECT_TTL_MS = 5 * 60 * 1000;
let detectCache: { ts: number; result: DetectedAgent[] } | null = null;

export async function detectAll(opts?: { force?: boolean }): Promise<DetectedAgent[]> {
  const now = Date.now();
  if (!opts?.force && detectCache && now - detectCache.ts < DETECT_TTL_MS) {
    return detectCache.result;
  }
  const result = await Promise.all(AGENT_DEFS.map(detectOne));
  detectCache = { ts: now, result };
  return result;
}
