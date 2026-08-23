/**
 * Dirty-frame cache for multi-frame export.
 *
 * Per-frame MP4s are keyed by graph node id (not play order) so reordering
 * frames does not invalidate a still-identical render. A frame is reused when
 * its fingerprint matches the last successful export AND the cache file is
 * still on disk. Set HV_FORCE_RERENDER=1 to skip the cache.
 */

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FrameRecord } from './types/index.js';

export interface FrameFingerprintInput {
  durationSec: number;
  engine: string;
  nativeTemplateId?: string;
  data?: unknown;
  /** HTML source. Ignored for Remotion native frames (they render from `data`). */
  html?: string | null;
  width: number;
  height: number;
  fps: number;
  variables: Record<string, unknown>;
}

export function isForceRerender(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.HV_FORCE_RERENDER;
  return v === '1' || v === 'true';
}

export function frameCachePath(cacheDir: string, graphNodeId: string): string {
  const safeId = graphNodeId.replace(/[^a-z0-9_-]/gi, '_');
  return join(cacheDir, `${safeId}.mp4`);
}

export function isRemotionNativeFrame(frame: {
  engine?: string;
  nativeTemplateId?: string;
}): boolean {
  return frame.engine === 'remotion' && !!frame.nativeTemplateId;
}

/** Canonical stringify so key order in variables/data does not bust the cache. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function frameRenderFingerprint(input: FrameFingerprintInput): string {
  const remotionNative = input.engine === 'remotion' && !!input.nativeTemplateId;
  const payload = {
    durationSec: input.durationSec,
    engine: input.engine,
    nativeTemplateId: remotionNative ? (input.nativeTemplateId ?? '') : '',
    data: remotionNative ? (input.data ?? null) : null,
    html: remotionNative ? '' : (input.html ?? ''),
    width: input.width,
    height: input.height,
    fps: input.fps,
    variables: input.variables,
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 32);
}

export function shouldReuseFrameRender(opts: {
  fingerprint: string;
  previousFingerprint?: string;
  cachePath: string;
  force?: boolean;
}): boolean {
  if (opts.force) return false;
  if (!opts.previousFingerprint || opts.previousFingerprint !== opts.fingerprint) return false;
  if (!existsSync(opts.cachePath)) return false;
  try {
    return statSync(opts.cachePath).size > 0;
  } catch {
    return false;
  }
}

export async function planFrameRender(args: {
  frame: FrameRecord;
  projectEngine: string;
  resolution: { width: number; height: number };
  fps: number;
  variables: Record<string, unknown>;
  cacheDir: string;
  force?: boolean;
}): Promise<{ cachePath: string; fingerprint: string; reuse: boolean }> {
  const engine = args.frame.engine ?? args.projectEngine;
  const remotionNative = isRemotionNativeFrame(args.frame);
  let html: string | null = null;
  if (!remotionNative && args.frame.htmlPath && existsSync(args.frame.htmlPath)) {
    html = await readFile(args.frame.htmlPath, 'utf8');
  }
  const fingerprint = frameRenderFingerprint({
    durationSec: args.frame.durationSec,
    engine,
    nativeTemplateId: args.frame.nativeTemplateId,
    data: args.frame.data,
    html,
    width: args.resolution.width,
    height: args.resolution.height,
    fps: args.fps,
    variables: args.variables,
  });
  const cachePath = frameCachePath(args.cacheDir, args.frame.graphNodeId);
  const reuse = shouldReuseFrameRender({
    fingerprint,
    previousFingerprint: args.frame.renderFingerprint,
    cachePath,
    force: args.force,
  });
  return { cachePath, fingerprint, reuse };
}
