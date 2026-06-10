import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type { AgentDef } from '../types.js';

const exec = promisify(execFile);

/**
 * Open Design AMR (Vela) agent.
 *
 * AMR is the `vela` CLI's ACP stdio mode: `vela agent run --runtime opencode`
 * starts a private OpenCode server and speaks ACP JSON-RPC over stdio. The user
 * authenticates once in the Open Design app (`vela login`, browser OAuth) — we
 * reuse that login state, never ask for an API key.
 *
 * Binary resolution (so every user can use AMR, not just OD installers):
 *   1. PATH (`vela`)
 *   2. Open Design.app bundle (reuse an existing OD install)
 *   3. @powerformer/vela-cli npm package — ships per-platform `vela` binaries,
 *      so html-video bundles AMR support without any external install.
 *   ($OPEN_DESIGN_VELA_CLI_BIN overrides everything, matching OD's env knob.)
 *
 * Login state lives in ~/.vela/config.json (profile → runtimeKey/apiUrl/user);
 * each user signs in with their OWN OD/AMR account (browser OAuth via
 * `vela login`) — html-video never holds a key. We treat a profile with a
 * runtimeKey + `vela whoami` success as "logged in".
 *
 * Stage 2 (this revision): bundled-binary distribution via vela-cli.
 * The ACP JSON-RPC client (initialize → session/new → session/prompt → streamed
 * session/update) lands in stage 4.
 */

const VELA_CLI_BIN_ENV = 'OPEN_DESIGN_VELA_CLI_BIN';

const VELA_BUNDLE_FALLBACKS = [
  '/Applications/Open Design.app/Contents/Resources/open-design/bin/vela',
  join(homedir(), 'Applications/Open Design.app/Contents/Resources/open-design/bin/vela'),
];

/** Resolve `vela` from the bundled @powerformer/vela-cli npm package (per-platform
 *  binaries). Returns an absolute path, or null if the package isn't installed /
 *  has no binary for this platform. */
async function resolveBundledVela(): Promise<string | null> {
  const envOverride = process.env[VELA_CLI_BIN_ENV]?.trim();
  if (envOverride) return envOverride;
  try {
    const mod = (await import('@powerformer/vela-cli')) as unknown as {
      resolveVelaCliBin?: (opts?: { strict?: boolean }) => unknown;
    };
    if (typeof mod.resolveVelaCliBin !== 'function') return null;
    const resolved = await Promise.resolve(mod.resolveVelaCliBin({ strict: false }));
    if (typeof resolved === 'string') return resolved.trim() || null;
    if (resolved && typeof resolved === 'object') {
      const p = (resolved as { path?: unknown }).path;
      if (typeof p === 'string') return p.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

interface VelaProfile {
  runtimeKey?: string;
  apiUrl?: string;
  user?: { email?: string; plan?: string } | null;
}

/** Read ~/.vela/config.json and return the active profile (prod by default). */
export function readVelaProfile(): { name: string; profile: VelaProfile } | null {
  try {
    const raw = readFileSync(join(homedir(), '.vela', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw) as { profiles?: Record<string, VelaProfile> };
    const profiles = cfg.profiles ?? {};
    const name = process.env.VELA_PROFILE?.trim() || (profiles.prod ? 'prod' : Object.keys(profiles)[0] ?? '');
    const profile = profiles[name];
    return profile ? { name, profile } : null;
  } catch {
    return null;
  }
}

export const amr: AgentDef = {
  id: 'amr',
  name: 'Open Design AMR',
  bin: 'vela',
  binFallbacks: VELA_BUNDLE_FALLBACKS,
  resolveBinFallback: resolveBundledVela,
  versionArgs: ['--version'],
  // ACP stdio runtime: starts a private OpenCode server, talks JSON-RPC.
  buildArgs: () => ['agent', 'run', '--runtime', 'opencode'],
  streamFormat: 'acp-json-rpc',
  // Identify html-video as the host so the vela CLI tags its command +
  // model_request analytics with source=html_video (revenue attribution).
  env: { AMR_CLIENT_SOURCE: 'html_video' },
  // AMR home; ?source=html_video lets vela's home page_view attribute the visit
  // to html-video (same host dimension as the model-spend attribution above).
  installUrl: 'https://open-design.ai/amr?source=html_video',
  // AMR rejects session/prompt until a model is set. Default to deepseek-v4-flash
  // (the "Lower cost / Many models" official pick); overridable per-call later.
  defaultModel: 'deepseek-v4-flash',

  // Found on disk → confirm the user is actually logged in. AMR needs no API
  // key, but it does need a live `vela login` session.
  async extraDetect(resolvedBin: string) {
    const prof = readVelaProfile();
    if (!prof || !prof.profile.runtimeKey) {
      return { available: false, hint: 'Sign in to AMR in the Open Design app first (vela login).' };
    }
    // whoami is the authoritative liveness check — the stored runtimeKey can
    // expire even when config.json still looks populated.
    try {
      const { stdout } = await exec(resolvedBin, ['whoami'], { timeout: 6000 });
      const out = stdout.trim();
      if (/not logged in|run `?vela login`?/i.test(out)) {
        return { available: false, hint: 'AMR session expired — re-run vela login in Open Design.' };
      }
      const email = prof.profile.user?.email;
      const plan = prof.profile.user?.plan;
      return { available: true, version: `AMR${email ? ` · ${email}` : ''}${plan ? ` (${plan})` : ''}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not logged in/i.test(msg)) {
        return { available: false, hint: 'AMR session expired — re-run vela login in Open Design.' };
      }
      return { available: false, hint: `vela whoami failed: ${msg.slice(0, 120)}` };
    }
  },
};

/** Preferred ordering — surface the cheap/fast default + flagships first. */
const AMR_MODEL_RANK: ReadonlyMap<string, number> = new Map(
  ['deepseek-v4-flash', 'deepseek-v4-pro', 'claude-opus-4.8', 'claude-sonnet-4.6', 'gpt-5.5', 'gemini-3.1-pro-preview']
    .map((id, i) => [id, i]),
);

export interface AmrModel { id: string; label: string }

/**
 * List the live AMR catalog via `vela model list`. Each line is
 * `<model-id>\t<provider>`; the id is already the link-facing slug AMR accepts
 * in session/set_model, so no normalization is needed. Ordered preferred-first.
 */
export async function listAmrModels(resolvedBin: string): Promise<AmrModel[]> {
  const { stdout } = await exec(resolvedBin, ['model', 'list'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  const seen = new Set<string>();
  const models: AmrModel[] = [];
  for (const line of String(stdout).split('\n')) {
    const id = line.split('\t')[0]?.trim();
    if (!id || id.startsWith('#') || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models.sort((a, b) => {
    const ra = AMR_MODEL_RANK.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = AMR_MODEL_RANK.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || a.id.localeCompare(b.id);
  });
}
