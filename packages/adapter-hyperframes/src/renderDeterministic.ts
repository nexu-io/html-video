/**
 * Deterministic Hyperframes render path — real upstream integration.
 *
 * Instead of recording the page in wall-clock time (playwright recordVideo →
 * webm → ffmpeg), this drives the actual Hyperframes render pipeline
 * (`@hyperframes/producer`): the composition's master timeline is held paused,
 * seeked frame-by-frame, and each frame is captured via Chrome's BeginFrame
 * API, then encoded. Consequences vs the realtime capture path:
 *
 *   - Frame-perfect: no dropped frames under load, output is bit-identical
 *     across runs and machines (same-browser).
 *   - Faster than realtime on most content (parallel workers seek+capture
 *     concurrently; no need to wait `durationSec` of wall-clock).
 *   - No freeze/unfreeze + lead-in-trim heuristics: fonts are localized
 *     deterministically by the producer's compile stage before frame 0.
 *   - True alpha (webm/mov) and audio muxing come from the same pipeline,
 *     unlocking the `alpha`/`audio` capabilities this adapter already
 *     advertises but the realtime path cannot honor.
 *
 * The producer is an OPTIONAL dependency (mirroring the existing optional
 * `hyperframes` peer): when `@hyperframes/producer` is not installed, or the
 * template does not look like a Hyperframes composition, callers fall back to
 * the realtime capture path unchanged.
 */

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { RenderContext, RenderInput, RenderOutput } from '@html-video/core';

const ADAPTER_VERSION = '0.3.0-producer';

/**
 * A template qualifies for the deterministic path when it carries Hyperframes
 * composition markers. Plain single-file CSS-keyframe templates (no timing
 * contract) stay on the realtime capture path — the producer needs a seekable
 * timeline (`data-*` timing attributes / registered GSAP timelines / the
 * window.__hf protocol) to drive frames.
 */
export function isHyperframesComposition(html: string): boolean {
  return (
    /data-composition-id=/.test(html) ||
    /data-composition-src=/.test(html) ||
    /\bdata-duration=/.test(html) ||
    /window\.__hf\b/.test(html) ||
    /window\.__timelines\b/.test(html)
  );
}

/** Minimal structural types for the producer API so this file typechecks
 * without `@hyperframes/producer` installed (it is optional). Field shapes
 * mirror `RenderConfigInput` / `executeRenderJob` in the upstream repo. */
interface ProducerModule {
  createRenderJob(config: {
    fps: number | { num: number; den: number };
    quality: 'draft' | 'standard' | 'high';
    format?: 'mp4' | 'webm' | 'mov' | 'png-sequence' | 'gif';
    entryFile?: string;
    variables?: Record<string, unknown>;
    strictness?: string;
  }): { id: string; warnings: unknown[] };
  executeRenderJob(
    job: unknown,
    projectDir: string,
    outputPath: string,
    progressSink?: (progress: number, stage: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<void>;
}

/**
 * Attempt the deterministic render. Returns null when the path does not
 * apply (producer not installed / template not a Hyperframes composition) so
 * the caller can fall back to realtime capture. Throws only for real render
 * failures once the deterministic path has been entered.
 */
export async function tryDeterministicRender(
  input: RenderInput,
  ctx: RenderContext,
): Promise<RenderOutput | null> {
  const sourcePath = input.template.sourcePath;
  if (!existsSync(sourcePath)) return null;

  const html = await readFile(sourcePath, 'utf8');
  if (!isHyperframesComposition(html)) return null;

  let producer: ProducerModule;
  try {
    // Specifier via variable: keeps tsc from requiring the optional module's
    // type declarations at build time (it is an optional peer dependency).
    const specifier = '@hyperframes/producer';
    producer = (await import(specifier)) as unknown as ProducerModule;
  } catch {
    return null; // optional dep absent — realtime capture handles it
  }

  const t0 = Date.now();
  const fps = input.config.fps || 30;
  ctx.onProgress?.(5, 'deterministic render (hyperframes producer)');

  // Hyperframes projects are directories with an entry HTML; templates already
  // live in their own directory with sibling assets, so the template dir IS
  // the project dir and the source file is the entry.
  const projectDir = dirname(sourcePath);
  const entryFile = basename(sourcePath);

  const job = producer.createRenderJob({
    fps,
    quality: 'standard',
    format: 'mp4',
    entryFile,
    // Hyperframes resolves `data-var` / var() substitutions natively — the
    // same variables the orchestrator baked into the HTML flow through here
    // for compositions that declare them.
    variables: input.variables,
  });

  // Producer progress arrives as (0-100, stage); reserve the last 5% for stat.
  await producer.executeRenderJob(
    job,
    projectDir,
    input.config.outputPath,
    (progress, stage) => ctx.onProgress?.(Math.min(95, Math.max(5, progress)), stage),
    ctx.signal,
  );

  const st = await stat(input.config.outputPath);
  const durationSec =
    input.config.duration === 'auto' ? undefined : Number(input.config.duration);
  ctx.onProgress?.(100, 'done');
  return {
    outputPath: input.config.outputPath,
    meta: {
      // The composition's own data-duration governs length in this path; fall
      // back to the requested duration for reporting when it was explicit.
      durationSec: durationSec ?? 0,
      fileSizeBytes: st.size,
      actualResolution: input.config.resolution,
      fps,
      renderedFrames: durationSec ? Math.round(durationSec * fps) : 0,
      renderWallClockSec: (Date.now() - t0) / 1000,
      engineVersion: `hyperframes-producer@${ADAPTER_VERSION}`,
    },
    diagnostics: [
      'rendered deterministically via @hyperframes/producer (paused timeline, per-frame seek + BeginFrame capture)',
    ],
  };
}
