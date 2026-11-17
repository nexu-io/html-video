/**
 * RFC-11 footage-edit command: takes → transcribe → select → EDL → cut → concat
 * → re-transcribe verify. The whole "edit is text" loop, headless.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  buildFootageGraph,
  concatClips,
  cutClip,
  fillersIn,
  type Asset,
  type SceneSpec,
  type Transcript,
} from '@html-video/core';
import type { FootageNode } from '@html-video/content-graph';
import type { CliContext } from '../context.js';
import { fail, ok, progress } from '../output.js';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi']);

export interface FootageEditOptions {
  takes: string;
  scenes?: string;
  out?: string;
  work?: string;
  model?: string;
  source?: string;
}

export async function footageEdit(ctx: CliContext, opts: FootageEditOptions): Promise<void> {
  const takesDir = resolve(opts.takes);
  if (!existsSync(takesDir)) return fail('invalid-input', `takes dir not found: ${takesDir}`);

  // discover takes → assets (id = filename without extension)
  const files = (await readdir(takesDir))
    .filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) return fail('invalid-input', `no video files in ${takesDir}`);
  const assets: Record<string, Asset> = {};
  for (const f of files) {
    const id = f.slice(0, f.length - extname(f).length);
    assets[id] = {
      id,
      type: 'video',
      path: join(takesDir, f),
      metadata: { filename: f },
      userTags: [],
    };
  }

  // scenes: explicit spec, or one scene per take in filename order
  let scenes: SceneSpec[];
  if (opts.scenes) {
    const raw = await readFile(resolve(opts.scenes), 'utf8');
    scenes = JSON.parse(raw) as SceneSpec[];
    const missing = scenes.flatMap((s) => s.takes).filter((t) => !assets[t]);
    if (missing.length) return fail('invalid-input', `scenes reference unknown takes: ${[...new Set(missing)].join(', ')}`);
  } else {
    scenes = Object.keys(assets).map((id, i) => ({ scene: i + 1, title: id, takes: [id] }));
  }

  const work = resolve(opts.work ?? join(takesDir, '..', 'hv-footage-work'));
  await mkdir(work, { recursive: true });
  const outPath = resolve(opts.out ?? join(work, 'final.mp4'));
  if (opts.model) process.env.HTMLVIDEO_WHISPER_MODEL = resolve(opts.model);

  const source = ctx.sources.get(opts.source ?? 'whisper-local');

  // 1. transcribe every candidate take
  const transcripts: Record<string, Transcript> = {};
  const allTakes = [...new Set(scenes.flatMap((s) => s.takes))];
  for (let i = 0; i < allTakes.length; i++) {
    const id = allTakes[i]!;
    progress('transcribe', Math.round((i / allTakes.length) * 100), { take: id });
    try {
      const t = await source.transcribe(assets[id]!, { workDir: work });
      transcripts[id] = t;
      await writeFile(join(work, `${id}.transcript.json`), JSON.stringify(t, null, 2));
    } catch (err) {
      return fail('render-failed', `transcribe ${id} failed: ${(err as Error).message}`);
    }
  }

  // 2. select best take per scene → EDL graph
  progress('select', 100, {});
  const graph = buildFootageGraph(scenes, transcripts);
  const edlPath = join(work, 'final-edit.json');
  await writeFile(edlPath, JSON.stringify(graph, null, 2));
  const nodes = graph.nodes as FootageNode[];

  // 3. frame-accurate cut each pick, then concat-filter
  const segDir = join(work, 'cuts');
  await mkdir(segDir, { recursive: true });
  const segs: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    progress('cut', Math.round((i / nodes.length) * 100), { scene: n.id, take: n.clipAssetId });
    const seg = join(segDir, `${n.id}.mp4`);
    await cutClip(assets[n.clipAssetId]!.path!, n.in, n.out, seg);
    segs.push(seg);
  }
  progress('concat', 100, {});
  await concatClips(segs, outPath);

  // 4. re-transcribe the cut and self-check (deck's "zero ums" verification)
  progress('verify', 100, {});
  let verify: { transcript: string; fillers: string[] } | { error: string };
  try {
    const finalT = await source.transcribe(
      { id: '_final', type: 'video', path: outPath, metadata: {}, userTags: [] },
      { workDir: work },
    );
    verify = {
      transcript: finalT.words.map((w) => w.word.trim()).join(' '),
      fillers: fillersIn(finalT.words),
    };
  } catch (err) {
    verify = { error: (err as Error).message };
  }

  ok({
    out: outPath,
    edl: edlPath,
    work,
    takes: allTakes.length,
    scenes: scenes.length,
    picks: nodes.map((n) => ({
      scene: n.id,
      pick: n.clipAssetId,
      in: n.in,
      out: n.out,
      firstWords: n.firstWords,
      rationale: n.selectionRationale,
    })),
    verify,
    clean: 'fillers' in verify ? verify.fillers.length === 0 : false,
  });
}
