/**
 * @html-video/core — RFC-11 footage edit primitives.
 *
 * The "edit is text" pipeline back-end: turn word-level transcripts into an EDL
 * (a content-graph of footage nodes, each with the takes considered and the
 * written reason for the pick), then frame-accurately cut and join the picks
 * with ffmpeg.
 *
 * Pure logic (selection / EDL building) is dependency-free and unit-tested;
 * the ffmpeg ops shell out and surface the same friendly missing-binary hint
 * as the rest of core.
 */
import type { ContentGraph, Edge, FootageNode } from '@html-video/content-graph';
import type { Transcript, TranscriptWord } from './types/index.js';
import { HtmlVideoError } from './errors.js';

// ---------------------------------------------------------------------------
// Filler detection
// ---------------------------------------------------------------------------

/** Disfluencies a clean take should not contain. Matched on normalised tokens. */
export const FILLER_WORDS = new Set([
  'um', 'uh', 'ah', 'er', 'erm', 'hmm', 'uhh', 'umm', 'mm', 'eh',
]);

/** Lowercase + strip everything but a–z, so `"Ah!"` / `um,` still match. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

/** The filler tokens present in a word list (verbatim, for reporting). */
export function fillersIn(words: TranscriptWord[]): string[] {
  return words.filter((w) => FILLER_WORDS.has(normalizeWord(w.word))).map((w) => w.word);
}

// ---------------------------------------------------------------------------
// Take selection → EDL
// ---------------------------------------------------------------------------

/** A scene and its candidate takes, in shoot order (best is usually last). */
export interface SceneSpec {
  /** Stable scene id used as the footage node id (e.g. 1 or "intro"). */
  scene: string | number;
  title: string;
  /** Candidate take asset ids, in the order they were shot. */
  takes: string[];
  /** A leading warm-up phrase to cut from the kept take ("hey everyone"). */
  warmup?: string;
}

export interface SelectOptions {
  /** Seconds to nudge the cut-in earlier, into the silent gap. Default 0.05. */
  lead?: number;
  /** Seconds of tail to keep after the last word. Default 0.15. */
  tail?: number;
}

function endsSentence(word: string): boolean {
  return /[.!?]["')\]]?$/.test(word.trim());
}

/**
 * Pick the best take for one scene and return it as a footage node (the EDL
 * entry). Heuristic mirrors how editors triage口播 takes: zero fillers and a
 * complete ending win; ties break toward the later take. The chosen take's
 * leading warm-up phrase is trimmed by starting the cut at the first content
 * word after it. Every rejected take and the reason is written into the node.
 */
export function selectTake(
  scene: SceneSpec,
  transcripts: Record<string, Transcript>,
  opts: SelectOptions = {},
): FootageNode {
  const lead = opts.lead ?? 0.05;
  const tail = opts.tail ?? 0.15;
  const cand = scene.takes;
  if (cand.length === 0) {
    throw new HtmlVideoError('invalid-input', `Scene "${scene.scene}" has no candidate takes`);
  }

  const scored = cand.map((clip, i) => {
    const words = transcripts[clip]?.words ?? [];
    const fillers = fillersIn(words);
    const complete = words.length > 0 && endsSentence(words[words.length - 1]!.word);
    // later takes get a small positional tiebreak (best take usually last)
    const score = (fillers.length ? -10 * fillers.length : 0) + (complete ? 5 : 0) + i;
    return { clip, i, words, fillers, complete, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const words = best.words;
  if (words.length === 0) {
    throw new HtmlVideoError(
      'invalid-input',
      `No usable transcript for any take in scene "${scene.scene}" (picked ${best.clip})`,
    );
  }

  // cut-in: skip a leading warm-up phrase if present
  let inIdx = 0;
  if (scene.warmup) {
    const norm = words.map((w) => normalizeWord(w.word));
    const phrase = scene.warmup.split(/\s+/).map(normalizeWord).filter(Boolean);
    for (let j = 0; j + phrase.length <= norm.length; j++) {
      if (phrase.every((p, k) => norm[j + k] === p)) {
        inIdx = j + phrase.length;
        break;
      }
    }
  }
  const tIn = Math.max(0, words[inIdx]!.start - lead);
  const tOut = words[words.length - 1]!.end + tail;
  const firstWords = words
    .slice(inIdx, inIdx + 5)
    .map((w) => w.word.trim())
    .join(' ');

  const dropped = scored
    .filter((s) => s.clip !== best.clip)
    .map((s) =>
      s.fillers.length
        ? `${s.clip} dropped (fillers: ${s.fillers.join(', ')})`
        : !s.complete
          ? `${s.clip} dropped (incomplete take)`
          : `${s.clip} dropped (earlier alt take)`,
    );
  let rationale = `${best.clip} is the cleanest complete take (${
    best.fillers.length ? `${best.fillers.length} fillers` : 'zero fillers'
  }).`;
  if (dropped.length) rationale += ` ${dropped.join('; ')}.`;
  if (scene.warmup && inIdx > 0) {
    rationale += ` Warm-up "${scene.warmup}" cut: cut-in at ${tIn.toFixed(2)}s in the silent gap.`;
  }

  return {
    kind: 'footage',
    id: `scene${scene.scene}`,
    label: scene.title,
    clipAssetId: best.clip,
    candidateClipAssetIds: cand,
    in: round3(tIn),
    out: round3(tOut),
    firstWords,
    selectionRationale: rationale,
  };
}

/**
 * Build a complete EDL content-graph: one footage node per scene, joined by
 * sequence edges in scene order. Mixes cleanly with synthesised nodes later.
 */
export function buildFootageGraph(
  scenes: SceneSpec[],
  transcripts: Record<string, Transcript>,
  opts: SelectOptions = {},
): ContentGraph {
  const nodes = scenes.map((s) => selectTake(s, transcripts, opts));
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id, kind: 'sequence' });
  }
  return { schemaVersion: 1, intent: 'other', nodes, edges };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// ffmpeg ops
// ---------------------------------------------------------------------------

async function runFfmpeg(args: string[], label: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolveFn, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new HtmlVideoError(
            'render-failed',
            'ffmpeg not found on PATH. Install with `brew install ffmpeg` (macOS) or your platform equivalent.',
          ),
        );
      } else {
        reject(err);
      }
    });
    proc.on('exit', (code: number | null) => {
      if (code === 0) resolveFn();
      else
        reject(
          new HtmlVideoError(
            'render-failed',
            `ffmpeg ${label} exited with code ${code}: ${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

/**
 * Frame-accurate cut of [inSec, outSec] from a source clip. Decodes from the
 * start and trims with -ss/-to (re-encode) so the cut lands on the right frame
 * rather than the nearest keyframe.
 */
export async function cutClip(
  srcPath: string,
  inSec: number,
  outSec: number,
  outPath: string,
): Promise<void> {
  if (!(outSec > inSec)) {
    throw new HtmlVideoError('invalid-input', `cutClip: out (${outSec}) must exceed in (${inSec})`);
  }
  await runFfmpeg(
    [
      '-y', '-i', srcPath,
      '-ss', String(inSec), '-to', String(outSec),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-avoid_negative_ts', 'make_zero',
      outPath,
    ],
    'cut',
  );
}

/**
 * Join cut segments into one file with the concat **filter** (not the demuxer):
 * footage segments are independently encoded, so their PTS must be rebuilt or
 * the total duration mis-accumulates. Re-encodes to a uniform h264/aac. Keeps
 * audio (v=1:a=1), unlike the synthesised-frame concat which is video-only.
 */
export async function concatClips(clipPaths: string[], outPath: string): Promise<void> {
  if (clipPaths.length === 0) {
    throw new HtmlVideoError('invalid-input', 'concatClips: no segments to join');
  }
  if (clipPaths.length === 1) {
    await runFfmpeg(['-y', '-i', clipPaths[0]!, '-c', 'copy', outPath], 'concat');
    return;
  }
  const n = clipPaths.length;
  const inputs = clipPaths.flatMap((p) => ['-i', p]);
  const filter =
    clipPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${n}:v=1:a=1[v][a]`;
  await runFfmpeg(
    [
      '-y', ...inputs,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-movflags', '+faststart',
      outPath,
    ],
    'concat',
  );
}
