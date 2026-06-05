/**
 * Studio media-provider config — persists API credentials entered through the
 * Settings UI to `.html-video/media-config.json` under the project root, so
 * users don't have to set environment variables by hand.
 *
 * Credential precedence when resolving (config file wins over env, since the
 * GUI is the explicit user choice):
 *   media-config.json  →  OD_MINIMAX_API_KEY / MINIMAX_API_KEY env
 *
 * Mirrors open-design's `.od/media-config.json` shape loosely; we only need
 * MiniMax here. The file holds the raw key, so it lives in the gitignored
 * `.html-video/` runtime dir, never the repo.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMinimaxCredentials, type MinimaxCredentials } from '@html-video/core';

interface MediaConfig {
  minimax?: { apiKey?: string; baseUrl?: string };
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

  /** What the Settings UI shows: whether a key is set + masked key + base URL.
   *  Never returns the raw key. Reports the source (config file vs env). */
  getMinimaxStatus(): { configured: boolean; source: 'config' | 'env' | 'none'; maskedKey: string; baseUrl: string } {
    const cfg = this.read().minimax;
    if (cfg?.apiKey) {
      return { configured: true, source: 'config', maskedKey: mask(cfg.apiKey), baseUrl: cfg.baseUrl ?? '' };
    }
    const env = resolveMinimaxCredentials();
    if (env) {
      return { configured: true, source: 'env', maskedKey: mask(env.apiKey), baseUrl: env.baseUrl };
    }
    return { configured: false, source: 'none', maskedKey: '', baseUrl: '' };
  }

  /** Persist a key (and optional base URL) entered in the UI. */
  setMinimax(apiKey: string, baseUrl?: string): void {
    const cfg = this.read();
    cfg.minimax = { apiKey: apiKey.trim() };
    const b = (baseUrl ?? '').trim();
    if (b) cfg.minimax.baseUrl = b;
    this.write(cfg);
  }

  /** Forget the stored MiniMax key (env fallback, if any, still applies). */
  clearMinimax(): void {
    const cfg = this.read();
    delete cfg.minimax;
    this.write(cfg);
  }

  /** Resolve usable credentials: config file first, then env. null if neither. */
  resolveMinimax(): MinimaxCredentials | null {
    const cfg = this.read().minimax;
    if (cfg?.apiKey) {
      // Default to the international endpoint when none is set. The old
      // api.minimaxi.chat host is RETIRED server-side (issue #4); MiniMax now
      // splits into api.minimax.io (international) and api.minimaxi.com (China),
      // and keys are region-bound — so the Settings UI asks the user to pick.
      const baseUrl = (cfg.baseUrl || '').trim().replace(/\/$/, '') || 'https://api.minimax.io/v1';
      return { apiKey: cfg.apiKey, baseUrl };
    }
    return resolveMinimaxCredentials();
  }
}

function mask(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
