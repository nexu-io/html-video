/**
 * Studio media-provider config — persists API credentials entered through the
 * Settings UI to `.html-video/media-config.json` under the project root, so
 * users don't have to set environment variables by hand.
 *
 * Credential precedence when resolving (config file wins over env, since the
 * GUI is the explicit user choice):
 *   media-config.json  →  env (provider-specific keys)
 *
 * Two TTS providers are supported (background music is MiniMax-only):
 *   - minimax    — speech + music; region-bound keys (issue #4)
 *   - senseaudio — speech only (api.senseaudio.cn)
 * The file holds raw keys, so it lives in the gitignored `.html-video/` runtime
 * dir, never the repo.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveMinimaxCredentials,
  resolveSenseAudioCredentials,
  type MinimaxCredentials,
  type SenseAudioCredentials,
} from '@html-video/core';

export type AudioProvider = 'minimax' | 'senseaudio';

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

interface MediaConfig {
  minimax?: ProviderConfig;
  senseaudio?: ProviderConfig;
}

/** Default base URL per provider when the user didn't pick one. */
const DEFAULT_BASE_URL: Record<AudioProvider, string> = {
  // International endpoint; the old api.minimaxi.chat host is RETIRED (issue #4).
  minimax: 'https://api.minimax.io/v1',
  senseaudio: 'https://api.senseaudio.cn/v1',
};

export interface ProviderStatus {
  configured: boolean;
  source: 'config' | 'env' | 'none';
  maskedKey: string;
  baseUrl: string;
}

export class MediaConfigStore {
  private readonly path: string;
  private readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, '.html-video');
    this.path = join(this.dir, 'media-config.json');
  }

  private read(): MediaConfig {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as MediaConfig;
    } catch {
      return {};
    }
  }

  private write(cfg: MediaConfig): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  }

  private resolveEnv(provider: AudioProvider): { apiKey: string; baseUrl: string } | null {
    return provider === 'minimax' ? resolveMinimaxCredentials() : resolveSenseAudioCredentials();
  }

  // --- Generic, provider-keyed API ---------------------------------------

  /** What the Settings UI shows: whether a key is set + masked key + base URL.
   *  Never returns the raw key. Reports the source (config file vs env). */
  getStatus(provider: AudioProvider): ProviderStatus {
    const cfg = this.read()[provider];
    if (cfg?.apiKey) {
      return { configured: true, source: 'config', maskedKey: mask(cfg.apiKey), baseUrl: cfg.baseUrl ?? '' };
    }
    const env = this.resolveEnv(provider);
    if (env) {
      return { configured: true, source: 'env', maskedKey: mask(env.apiKey), baseUrl: env.baseUrl };
    }
    return { configured: false, source: 'none', maskedKey: '', baseUrl: '' };
  }

  /** Persist a key (and optional base URL) entered in the UI. */
  set(provider: AudioProvider, apiKey: string, baseUrl?: string): void {
    const cfg = this.read();
    const entry: ProviderConfig = { apiKey: apiKey.trim() };
    const b = (baseUrl ?? '').trim();
    if (b) entry.baseUrl = b;
    cfg[provider] = entry;
    this.write(cfg);
  }

  /** Forget the stored key for a provider (env fallback, if any, still applies). */
  clear(provider: AudioProvider): void {
    const cfg = this.read();
    delete cfg[provider];
    this.write(cfg);
  }

  /** Resolve usable credentials: config file first, then env. null if neither. */
  resolve(provider: AudioProvider): { apiKey: string; baseUrl: string } | null {
    const cfg = this.read()[provider];
    if (cfg?.apiKey) {
      const baseUrl = (cfg.baseUrl || '').trim().replace(/\/$/, '') || DEFAULT_BASE_URL[provider];
      return { apiKey: cfg.apiKey, baseUrl };
    }
    return this.resolveEnv(provider);
  }

  // --- Back-compat MiniMax-named shims (used elsewhere in studio-server) ----

  getMinimaxStatus(): ProviderStatus {
    return this.getStatus('minimax');
  }
  setMinimax(apiKey: string, baseUrl?: string): void {
    this.set('minimax', apiKey, baseUrl);
  }
  clearMinimax(): void {
    this.clear('minimax');
  }
  resolveMinimax(): MinimaxCredentials | null {
    return this.resolve('minimax');
  }
  resolveSenseAudio(): SenseAudioCredentials | null {
    return this.resolve('senseaudio');
  }
}

function mask(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
