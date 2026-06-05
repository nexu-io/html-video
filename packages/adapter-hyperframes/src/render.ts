/**
 * Hyperframes render() — real recording via Playwright + ffmpeg.
 *
 * Per-frame strategy (orchestrator already loops per node and concats):
 *   1. Launch chromium headless at the configured resolution
 *   2. Inject the Hyperframes runtime if available (templates using
 *      data-composition-src need it; inline templates are unaffected)
 *   3. recordVideo into a tmp dir
 *   4. file:// load the frame HTML
 *   5. wait `durationSec` so any opening animation completes + plays
 *   6. close → playwright dumps a webm
 *   7. ffmpeg transmux/encode the webm to mp4 at `outputPath`
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  HtmlSceneOutput,
  RenderContext,
  RenderInput,
  RenderOutput,
} from '@html-video/core';
import { HtmlVideoError } from '@html-video/core';

// ESM shim: adapter-hyperframes is an ES module but hyperframes is a CJS peer
// dep. createRequire lets us resolve its runtime script path without an import.
const require = createRequire(import.meta.url);

const ADAPTER_VERSION = '0.2.0-playwright';

/** Real render: chromium records the page, ffmpeg transcodes to MP4. */
export async function render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput> {
  const t0 = Date.now();
  ctx.onProgress?.(5, 'preparing');
  const outDir = dirname(input.config.outputPath);
  await mkdir(outDir, { recursive: true });
  if (ctx.signal?.aborted) throw new HtmlVideoError('cancelled', 'Aborted');

  // Resolve the source HTML path. Templates pass an absolute path already;
  // multi-frame `core` calls pass the per-frame HTML path the same way.
  if (!existsSync(input.template.sourcePath)) {
    throw new HtmlVideoError(
      'template-invalid',
      `Source HTML not found: ${input.template.sourcePath}`,
    );
  }

  let totalDuration =
    input.config.duration === 'auto' ? 5 : Math.max(0.5, Number(input.config.duration));
  const { width, height } = input.config.resolution;
  const fps = input.config.fps || 30;

  // Lazy-load playwright so the import cost only hits actual exports.
  ctx.onProgress?.(15, 'launching browser');
  const playwright = await import('playwright').catch((err) => {
    throw new HtmlVideoError(
      'render-failed',
      `playwright not installed (run \`pnpm install\` from the monorepo root). ${err instanceof Error ? err.message : err}`,
    );
  });
  const recordDir = await mkdtemp(join(tmpdir(), 'hv-render-'));

  // Resolve the Hyperframes runtime path early — templates that use
  // data-composition-src need the runtime injected before page load.
  // If hyperframes is not installed (optional peer dep), we fall back
  // gracefully: inline-only templates still render fine.
  let hyperframeRuntimePath: string | null = null;
  try {
    hyperframeRuntimePath = require.resolve('hyperframes/dist/hyperframe-runtime.js');
  } catch {
    // hyperframes peer dep not installed — templates that need it won't
    // render their compositions, but standalone inline templates will work.
  }

  let browser: import('playwright').Browser | undefined;
  let webmPath: string | undefined;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      recordVideo: { dir: recordDir, size: { width, height } },
    });
    const page = await context.newPage();

    ctx.onProgress?.(30, 'loading frame');
    const fileUrl = pathToFileURL(input.template.sourcePath).href;
    if (hyperframeRuntimePath) {
      await page.addInitScript({ path: hyperframeRuntimePath });
    }
    await page.goto(fileUrl, { waitUntil: 'load' });
    // Pages sometimes set up animations on the load tick — give a frame
    // for animations to actually start before we count the duration.
    await page.waitForTimeout(100);

    // Probe the frame's own animation length so we never cut it off. A short
    // per-frame duration set by the user could be < the frame's opening
    // animation, truncating it mid-play. Take the longer of the two: the frame
    // gets at least as long as its non-looping CSS animations / GSAP timeline.
    try {
      const animMs = await page.evaluate(() => {
        let maxMs = 0;
        Array.from(document.querySelectorAll('*')).forEach((el) => {
          const s = getComputedStyle(el);
          const durs = (s.animationDuration || '').split(',');
          const dels = (s.animationDelay || '').split(',');
          const iters = (s.animationIterationCount || '').split(',');
          durs.forEach((d, i) => {
            if ((iters[i] || '').trim() === 'infinite') return; // ignore looping bg anims
            maxMs = Math.max(maxMs, ((parseFloat(d) || 0) + (parseFloat(dels[i] || '0') || 0)) * 1000);
          });
        });
        // GSAP: do NOT use globalTimeline.totalDuration() — an infinitely
        // repeating tween (repeat:-1, e.g. a blinking cursor) makes it ~1e10s.
        // Walk the children and take the longest FINITE (non-repeat:-1) tween.
        const g = (window as unknown as {
          gsap?: { globalTimeline?: { getChildren?: (b?: boolean, t?: boolean, tl?: boolean) => Array<{ totalDuration?: () => number; repeat?: () => number; vars?: { repeat?: number } }> } };
        }).gsap;
        let gsapMs = 0;
        const children = g?.globalTimeline?.getChildren?.(true, true, true) ?? [];
        for (const c of children) {
          const repeat = typeof c.repeat === 'function' ? c.repeat() : (c.vars?.repeat ?? 0);
          if (repeat === -1) continue; // infinite loop — ignore
          const td = typeof c.totalDuration === 'function' ? c.totalDuration() : 0;
          if (Number.isFinite(td)) gsapMs = Math.max(gsapMs, td * 1000);
        }
        return Math.max(maxMs, gsapMs);
      });
      // +0.4s settle so the final animation frame is actually captured; cap at
      // 30s so a stray huge value can't make a frame run away.
      const needed = Math.min(30, (animMs + 400) / 1000);
      if (needed > totalDuration) {
        ctx.onProgress?.(38, `extending to ${needed.toFixed(1)}s for animation`);
        totalDuration = needed;
      }
    } catch { /* probe failed — fall back to the requested duration */ }

    ctx.onProgress?.(40, `recording ${totalDuration}s`);
    // Stream a single coarse progress tick per second so the user sees
    // "recording 1/5s …" type signal in the studio progress bar.
    const totalMs = Math.round(totalDuration * 1000);
    const tick = 250;
    const start = Date.now();
    while (Date.now() - start < totalMs) {
      if (ctx.signal?.aborted) throw new HtmlVideoError('cancelled', 'Aborted');
      await page.waitForTimeout(Math.min(tick, totalMs - (Date.now() - start)));
      const pct = 40 + Math.floor(((Date.now() - start) / totalMs) * 45);
      ctx.onProgress?.(pct, 'recording');
    }

    ctx.onProgress?.(85, 'finalising recording');
    await context.close();
    // playwright drops the webm into recordDir; pick the freshest .webm
    const candidates = readdirSync(recordDir).filter((f) => f.endsWith('.webm'));
    if (candidates.length === 0) {
      throw new HtmlVideoError('render-failed', `Playwright produced no webm in ${recordDir}`);
    }
    candidates.sort();
    webmPath = join(recordDir, candidates[candidates.length - 1]!);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // ---- ffmpeg: webm → mp4 ----
  ctx.onProgress?.(90, 'encoding mp4');
  await runFfmpeg([
    '-y',
    '-i', webmPath!,
    // Force exact duration: playwright's recordVideo sometimes overshoots
    // by the time it takes to close the context. -t trims to the requested
    // length (seconds, accepts fractions).
    '-t', String(totalDuration),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '20',
    '-movflags', '+faststart',
    input.config.outputPath,
  ]);

  // Clean tmp dir
  await rm(recordDir, { recursive: true, force: true }).catch(() => {});

  const st = await stat(input.config.outputPath);
  ctx.onProgress?.(100, 'done');
  return {
    outputPath: input.config.outputPath,
    meta: {
      durationSec: totalDuration,
      fileSizeBytes: st.size,
      actualResolution: input.config.resolution,
      fps,
      renderedFrames: Math.round(totalDuration * fps),
      renderWallClockSec: (Date.now() - t0) / 1000,
      engineVersion: `hyperframes-playwright@${ADAPTER_VERSION}`,
    },
    diagnostics: [`recorded via playwright/chromium then encoded with ffmpeg (libx264 crf20)`],
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new HtmlVideoError('render-failed',
          'ffmpeg not found on PATH. Install with `brew install ffmpeg` (macOS).'));
      } else reject(err);
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new HtmlVideoError(
        'render-failed',
        `ffmpeg exited ${code}: ${stderr.slice(-2000)}`,
      ));
    });
  });
}

/**
 * Render template to a single HTML preview.
 *
 * v0.1: read the source HTML file (a Hyperframes template is HTML+CSS+JS),
 * inject a banner showing the variables, copy referenced assets, write to ctx.workDir.
 * Real upstream Hyperframes integration will replace the inject + add a frame-bound clock.
 */
export async function renderToHtml(
  input: RenderInput,
  ctx: RenderContext,
): Promise<HtmlSceneOutput> {
  if (!existsSync(input.template.sourcePath)) {
    throw new HtmlVideoError(
      'template-invalid',
      `Source not found: ${input.template.sourcePath}`,
    );
  }

  await mkdir(ctx.workDir, { recursive: true });
  const htmlPath = join(ctx.workDir, 'preview.html');
  const posterPath = join(ctx.workDir, 'poster.svg');

  const sourceHtml = await readFile(input.template.sourcePath, 'utf8');
  const augmented = sourceHtml.replace(
    '</body>',
    `<script>
window.__HV_VARS__ = ${JSON.stringify(input.variables)};
window.__HV_DURATION__ = ${typeof input.config.duration === 'number' ? input.config.duration : 5};
console.log('html-video preview vars', window.__HV_VARS__);
</script></body>`,
  );
  await writeFile(htmlPath, augmented, 'utf8');

  // Cheap poster: an SVG placeholder we draw ourselves (no headless chromium yet).
  const { width, height } = input.config.resolution;
  const title = String(input.variables.title ?? input.template.id);
  const poster = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#1a1a1a"/>
  <text x="50%" y="50%" fill="#eee" font-family="Inter, system-ui, sans-serif"
        font-size="72" text-anchor="middle" dominant-baseline="middle">${escapeXml(title)}</text>
  <text x="50%" y="${height - 80}" fill="#888" font-family="monospace" font-size="32"
        text-anchor="middle">hyperframes · ${input.template.id}</text>
</svg>`;
  await writeFile(posterPath, poster, 'utf8');

  // Copy any referenced asset files mentioned in variables (best-effort)
  const referencedAssets: { assetId: string; usagePath: string }[] = [];
  for (const v of Object.values(input.variables)) {
    if (typeof v !== 'string') continue;
    if (!v.includes('/.html-video/bundles/')) continue;
    if (!existsSync(v)) continue;
    const dest = join(ctx.workDir, 'assets', v.split('/').pop() ?? 'asset');
    await mkdir(dirname(dest), { recursive: true });
    if (!existsSync(dest)) await copyFile(v, dest);
    const m = /assets\/([0-9a-f]{40})\./.exec(v);
    if (m && m[1]) {
      referencedAssets.push({ assetId: m[1], usagePath: dest });
    }
  }

  const totalDuration =
    input.config.duration === 'auto' ? 5 : input.config.duration;
  return {
    htmlPath,
    referencedAssets,
    posterPath,
    durationSec: totalDuration,
  };
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return map[c] ?? c;
  });
}

// silence unused imports warning until real impl uses them
void stat;
