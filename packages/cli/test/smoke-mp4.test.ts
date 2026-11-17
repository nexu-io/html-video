/**
 * Minimal 1-frame Hyperframes MP4 export — for PR CI (Playwright + ffmpeg).
 * Skips when HV_SMOKE_FAST=1 or when ffmpeg/ffprobe are missing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { detectChromiumPath } from '../../adapter-hyperframes/dist/detect.js';
import { bootstrap } from '../dist/context.js';

const FAST = process.env.HV_SMOKE_FAST === '1' || process.env.HV_SMOKE_FAST === 'true';

function hasCmd(cmd: string): boolean {
  return spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;
}

function ffprobeDurationSec(path: string): number {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(r.stderr || 'ffprobe failed');
  return Number.parseFloat(r.stdout.trim());
}

const skipReason = FAST
  ? 'HV_SMOKE_FAST=1'
  : !hasCmd('ffmpeg') || !hasCmd('ffprobe')
    ? 'ffmpeg/ffprobe not on PATH'
    : false;

test(
  '1-frame hyperframes MP4 export (frame-glitch-title, 3s)',
  { skip: skipReason || undefined, timeout: 180_000 },
  async (t) => {
    const chromiumPath = await detectChromiumPath();
    if (!chromiumPath) {
      t.skip('Playwright Chromium not installed (run: pnpm exec playwright install chromium)');
      return;
    }

    const projectRoot = await mkdtemp(join(tmpdir(), 'hv-mp4-smoke-'));
    await mkdir(join(projectRoot, '.html-video'), { recursive: true });
    const monorepoRoot = resolve(import.meta.dirname, '..', '..', '..');

    const ctx = await bootstrap({ cwd: projectRoot });
    if (ctx.templates.list().length === 0) {
      await ctx.templates.scan(join(monorepoRoot, 'templates'));
    }

    const project = await ctx.orchestrator.create({
      name: 'MP4 smoke',
      intent: 'Single-frame render regression',
      preferences: { aspect: '16:9' },
    });

    await ctx.orchestrator.setTemplate(project.id, 'frame-glitch-title');
    await ctx.orchestrator.setVariables(project.id, {
      title: 'SMOKE TEST',
      subtitle: 'html-video',
      duration_sec: 3,
    });

    const { outputPath } = await ctx.orchestrator.exportMp4({
      projectId: project.id,
    });

    if (!existsSync(outputPath)) throw new Error(`MP4 missing: ${outputPath}`);
    const size = statSync(outputPath).size;
    if (size < 1024) throw new Error(`MP4 too small (${size} bytes): ${outputPath}`);

    const dur = ffprobeDurationSec(outputPath);
    if (!Number.isFinite(dur) || dur < 2.5 || dur > 4.5) {
      throw new Error(`unexpected duration ${dur}s (expected ~3s): ${outputPath}`);
    }
  },
);
