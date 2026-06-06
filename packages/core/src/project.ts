/**
 * Project orchestrator: 单模板单视频工作流（RFC-05）。
 * - createProject
 * - addAsset / removeAsset
 * - setTemplate / setVariable / setVariables
 * - renderPreviewHtml: 调 EngineAdapter.renderToHtml() → HTML for iframe
 * - exportMp4: 调 EngineAdapter.render() → MP4 file
 */

import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import type {
  Asset,
  FrameRecord,
  Project,
  ProjectStatus,
  TemplateMetadata,
} from './types/index.js';
import {
  type ContentGraph,
  validate as validateGraph,
  topoSort,
  DEFAULT_FRAME_DURATION_SEC,
} from '@html-video/content-graph';
import { HtmlVideoError } from './errors.js';
import type { AssetStore } from './asset-store.js';
import type { EngineRegistry, ProjectStore, TemplateRegistry } from './registry.js';

export interface CreateProjectInput {
  name: string;
  intent?: string;
  preferences?: Project['preferences'];
}

export interface ProjectOrchestratorDeps {
  projectRoot: string;
  engines: EngineRegistry;
  templates: TemplateRegistry;
  projects: ProjectStore;
  assets: AssetStore;
}

export class ProjectOrchestrator {
  constructor(private readonly deps: ProjectOrchestratorDeps) {}

  // ---------------- CRUD ----------------

  async create(input: CreateProjectInput): Promise<Project> {
    const id = `proj_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name: input.name,
      ...(input.intent !== undefined && { intent: input.intent }),
      assets: [],
      templateId: null,
      variables: {},
      preferences: input.preferences ?? {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.projects.save(project);
    return project;
  }

  async list(): Promise<Project[]> {
    return this.deps.projects.list();
  }

  async load(id: string): Promise<Project> {
    return this.deps.projects.load(id);
  }

  async remove(id: string): Promise<void> {
    return this.deps.projects.remove(id);
  }

  // ---------------- Asset ops ----------------

  async addFileAsset(projectId: string, sourcePath: string, userCaption?: string): Promise<Project> {
    await this.deps.projects.ensureDir(projectId);
    const project = await this.deps.projects.load(projectId);
    const asset = await this.deps.assets.addFileAsset(projectId, sourcePath, [], userCaption);
    if (!project.assets.find((a) => a.id === asset.id)) {
      project.assets.push(asset);
    }
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async addInlineAsset(
    projectId: string,
    content: string,
    type: 'text' | 'data',
    userCaption?: string,
  ): Promise<Project> {
    await this.deps.projects.ensureDir(projectId);
    const project = await this.deps.projects.load(projectId);
    const asset = await this.deps.assets.addInlineAsset(projectId, content, type, [], userCaption);
    if (!project.assets.find((a) => a.id === asset.id)) {
      project.assets.push(asset);
    }
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  /**
   * Store generated audio bytes (MP3 from MiniMax) as a project asset and
   * return the created Asset so the caller can reference it in `soundtrack`.
   * Unlike addFileAsset, this does NOT downgrade status — attaching a
   * soundtrack to an already-previewed video shouldn't invalidate the render.
   */
  async addBufferAsset(
    projectId: string,
    bytes: Buffer,
    ext: string,
    userCaption?: string,
  ): Promise<{ project: Project; asset: Asset }> {
    await this.deps.projects.ensureDir(projectId);
    const project = await this.deps.projects.load(projectId);
    const asset = await this.deps.assets.addBufferAsset(projectId, bytes, ext, [], userCaption);
    if (!project.assets.find((a) => a.id === asset.id)) {
      project.assets.push(asset);
    }
    await this.deps.projects.save(project);
    return { project, asset };
  }

  async removeAsset(projectId: string, assetId: string): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.assets = project.assets.filter((a) => a.id !== assetId);
    await this.deps.projects.save(project);
    return project;
  }

  // ---------------- Template / variables ----------------

  async setTemplate(projectId: string, templateId: string | null): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    if (templateId !== null && !this.deps.templates.has(templateId)) {
      throw new HtmlVideoError('template-not-found', `Template ${templateId} not found`);
    }
    project.templateId = templateId;
    // v0.3: variables are no longer the user-facing surface. Reset on every
    // template change so old keys don't bleed through into the new context.
    project.variables = {};
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setVariables(projectId: string, vars: Record<string, unknown>): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.variables = vars;
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setVariable(projectId: string, key: string, value: unknown): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.variables = { ...project.variables, [key]: value };
    project.status = downgradeStatus(project.status, 'draft');
    await this.deps.projects.save(project);
    return project;
  }

  async setAgent(projectId: string, agentId: string | null, agentModel?: string | null): Promise<Project> {
    const project = await this.deps.projects.load(projectId);
    project.agentId = agentId;
    // Only touch the model when explicitly provided; switching agent clears a
    // stale model unless a new one is given.
    if (agentModel !== undefined) project.agentModel = agentModel;
    else project.agentModel = null;
    await this.deps.projects.save(project);
    return project;
  }

  /**
   * v0.3 chat-to-HTML: write raw HTML produced by an agent into the project's preview slot.
   * Single-frame fast-path. Clears any prior multi-frame graph state.
   */
  async writePreviewHtmlRaw(projectId: string, html: string): Promise<{ project: Project; htmlPath: string }> {
    const project = await this.deps.projects.load(projectId);
    const projectDir = await this.deps.projects.ensureDir(projectId);
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const htmlPath = join(projectDir, 'preview.html');
    await writeFile(htmlPath, html, 'utf8');
    project.lastPreviewHtmlPath = htmlPath;
    // v0.8.2: only treat this as a "supersedes the storyboard" event for
    // truly fresh single-frame projects (no frames yet). For projects that
    // already have a storyboard, the single-frame raw write is treated as
    // an in-place inline edit on the active preview file — frames[] /
    // contentGraphPath are preserved so the user doesn't lose their
    // storyboard if they happen to use a single-frame iteration on a
    // multi-frame project. (Frame-specific in-place edits should go
    // through writeFrameHtml instead.)
    if ((project.frames?.length ?? 0) === 0) {
      project.frames = [];
      delete project.contentGraphPath;
    }
    if (project.status === 'draft') project.status = 'previewed';
    await this.deps.projects.save(project);
    return { project, htmlPath };
  }

  // ---------------- v0.8: ContentGraph + multi-frame ----------------

  /**
   * Persist a content graph alongside the project. Validates first, throws
   * on cycles / unknown edges / etc.
   */
  async writeContentGraph(
    projectId: string,
    graph: ContentGraph,
    opts: { preserveFrames?: boolean } = {},
  ): Promise<{ project: Project; graphPath: string }> {
    const result = validateGraph(graph);
    if (!result.ok) {
      throw new HtmlVideoError(
        'invalid-input',
        `ContentGraph invalid: ${result.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const project = await this.deps.projects.load(projectId);
    const projectDir = await this.deps.projects.ensureDir(projectId);
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const graphPath = join(projectDir, 'content-graph.json');
    await writeFile(graphPath, JSON.stringify(graph, null, 2), 'utf8');
    project.contentGraphPath = graphPath;
    await mkdir(join(projectDir, 'frames'), { recursive: true });
    if (opts.preserveFrames) {
      // Editing an existing storyboard's metadata (e.g. re-pacing durations) —
      // keep the rendered frames, just sync each frame's durationSec from the
      // graph so export uses the new timing.
      const byId = new Map(graph.nodes.map((n) => [n.id, n.durationSec]));
      project.frames = (project.frames ?? []).map((f) => ({
        ...f,
        durationSec: byId.get(f.graphNodeId) ?? f.durationSec,
      }));
    } else {
      // Fresh graph → agent will re-emit per-frame HTML; drop stale frames.
      project.frames = [];
      if (project.status !== 'rendered') project.status = 'draft';
    }
    await this.deps.projects.save(project);
    return { project, graphPath };
  }

  /**
   * Read the persisted content graph. Returns null if none.
   */
  async readContentGraph(projectId: string): Promise<ContentGraph | null> {
    const project = await this.deps.projects.load(projectId);
    if (!project.contentGraphPath) return null;
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    if (!existsSync(project.contentGraphPath)) return null;
    return JSON.parse(await readFile(project.contentGraphPath, 'utf8')) as ContentGraph;
  }

  /**
   * Write one frame's HTML to disk. Updates the project's frames[] list,
   * keeping play-order consistent with the graph's topo sort.
   *
   * Frame filenames follow `<order>-<nodeId>.html` for visual debuggability.
   */
  async writeFrameHtml(
    projectId: string,
    graphNodeId: string,
    html: string,
  ): Promise<{ project: Project; frame: FrameRecord }> {
    const project = await this.deps.projects.load(projectId);
    const graph = await this.readContentGraph(projectId);
    if (!graph) {
      throw new HtmlVideoError(
        'invalid-input',
        'Cannot write frame: project has no content graph yet',
      );
    }
    const order = topoSort(graph);
    const idx = order.indexOf(graphNodeId);
    if (idx === -1) {
      throw new HtmlVideoError(
        'invalid-input',
        `Graph node "${graphNodeId}" not found in content graph`,
      );
    }
    const node = graph.nodes.find((n) => n.id === graphNodeId)!;

    const projectDir = await this.deps.projects.ensureDir(projectId);
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const framesDir = join(projectDir, 'frames');
    await mkdir(framesDir, { recursive: true });
    const safeId = graphNodeId.replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${String(idx + 1).padStart(2, '0')}-${safeId}.html`;
    const htmlPath = join(framesDir, filename);
    await writeFile(htmlPath, html, 'utf8');

    const frame: FrameRecord = {
      graphNodeId,
      htmlPath,
      durationSec: node.durationSec ?? DEFAULT_FRAME_DURATION_SEC,
      order: idx,
    };
    project.frames = (project.frames ?? []).filter((f) => f.graphNodeId !== graphNodeId);
    project.frames.push(frame);
    project.frames.sort((a, b) => a.order - b.order);
    // First frame becomes the project preview when no single-frame HTML exists.
    if (project.frames[0]?.graphNodeId === graphNodeId) {
      project.lastPreviewHtmlPath = htmlPath;
    }
    if (project.status === 'draft') project.status = 'previewed';
    await this.deps.projects.save(project);
    return { project, frame };
  }

  // ---------------- Render: preview HTML / export MP4 ----------------

  async renderPreviewHtml(projectId: string): Promise<{ project: Project; htmlPath: string }> {
    const project = await this.deps.projects.load(projectId);
    if (!project.templateId) {
      throw new HtmlVideoError('invalid-input', 'Project has no template selected');
    }
    const tmpl = this.deps.templates.get(project.templateId);
    const adapter = this.deps.engines.get(tmpl.engine);
    if (!adapter.renderToHtml) {
      throw new HtmlVideoError(
        'render-failed',
        `Engine ${tmpl.engine} adapter does not support renderToHtml()`,
      );
    }
    const projectDir = await this.deps.projects.ensureDir(projectId);

    const out = await adapter.renderToHtml(
      {
        template: templateRefFromMeta(tmpl),
        variables: project.variables,
        config: {
          format: 'mp4',
          resolution: project.preferences.resolution ?? { width: 1920, height: 1080 },
          fps: project.preferences.fps ?? 60,
          duration: 'auto',
          outputPath: join(projectDir, 'output.mp4'),
        },
      },
      { workDir: projectDir },
    );

    project.lastPreviewHtmlPath = out.htmlPath;
    project.lastPreviewPosterPath = out.posterPath;
    if (project.status === 'draft') project.status = 'previewed';
    await this.deps.projects.save(project);
    return { project, htmlPath: out.htmlPath };
  }

  async exportMp4(args: {
    projectId: string;
    outputPath?: string;
    onProgress?: (pct: number, stage: string) => void;
    signal?: AbortSignal;
  }): Promise<{ project: Project; outputPath: string }> {
    const project = await this.deps.projects.load(args.projectId);
    const projectDir = await this.deps.projects.ensureDir(project.id);
    // Unique per-export filename so repeated exports of the SAME project don't
    // overwrite each other (different projects already have separate dirs).
    // output.mp4 stays as a stable "latest" alias updated after each export.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const outputPath = args.outputPath ?? join(projectDir, `output-${stamp}.mp4`);

    // v0.8: multi-frame path. If the project has frames[] from a content graph,
    // render each frame's HTML to a per-frame MP4, then ffmpeg concat them.
    if (project.frames && project.frames.length > 0) {
      const ordered = [...project.frames].sort((a, b) => a.order - b.order);
      const tmpl = project.templateId ? this.deps.templates.get(project.templateId) : null;
      const engineId = tmpl?.engine ?? 'hyperframes';
      const adapter = this.deps.engines.get(engineId);
      const frameMp4s: string[] = [];

      for (let i = 0; i < ordered.length; i++) {
        const f = ordered[i]!;
        const frameOut = join(projectDir, 'frames', `${String(i + 1).padStart(2, '0')}.mp4`);
        await adapter.render(
          {
            template: {
              id: `frame-${f.graphNodeId}`,
              engine: engineId,
              sourcePath: f.htmlPath,
            },
            variables: project.variables,
            config: {
              format: 'mp4',
              resolution: project.preferences.resolution ?? { width: 1920, height: 1080 },
              fps: project.preferences.fps ?? 60,
              duration: f.durationSec,
              // The user set per-frame length on the format card — honor it as a
              // hard cap so one runaway animation can't stretch a 4s frame to ~30s.
              durationMode: 'explicit',
              outputPath: frameOut,
            },
          },
          {
            workDir: projectDir,
            ...(args.onProgress !== undefined && {
              onProgress: (pct, stage) =>
                args.onProgress!((i + pct / 100) / ordered.length * 100, `frame ${i + 1}/${ordered.length}: ${stage}`),
            }),
            ...(args.signal !== undefined && { signal: args.signal }),
          },
        );
        frameMp4s.push(frameOut);
      }

      await concatFramesWithFfmpeg(frameMp4s, outputPath, projectDir);
      const totalDur = ordered.reduce((s, f) => s + (f.durationSec || 0), 0);
      await this.applySoundtrack(project, outputPath, totalDur, args.onProgress);
      project.lastOutputMp4Path = outputPath;
      recordExport(project, outputPath);
      project.status = 'rendered';
      await this.deps.projects.save(project);
      return { project, outputPath };
    }

    // Single-frame fast path (v0.7 behaviour).
    if (!project.templateId) {
      throw new HtmlVideoError('invalid-input', 'Project has no template selected');
    }
    const tmpl = this.deps.templates.get(project.templateId);
    const adapter = this.deps.engines.get(tmpl.engine);

    await adapter.render(
      {
        template: templateRefFromMeta(tmpl),
        variables: project.variables,
        config: {
          format: 'mp4',
          resolution: project.preferences.resolution ?? { width: 1920, height: 1080 },
          fps: project.preferences.fps ?? 60,
          duration: 'auto',
          outputPath,
        },
      },
      {
        workDir: projectDir,
        ...(args.onProgress !== undefined && { onProgress: args.onProgress }),
        ...(args.signal !== undefined && { signal: args.signal }),
      },
    );
    await this.applySoundtrack(project, outputPath, undefined, args.onProgress);
    project.lastOutputMp4Path = outputPath;
    recordExport(project, outputPath);
    project.status = 'rendered';
    await this.deps.projects.save(project);
    return { project, outputPath };
  }

  /**
   * If the project has a soundtrack (music and/or narration), mux it into the
   * just-rendered video at `outputPath`. Renders to a temp file then renames
   * over the original. No-op when there's no soundtrack. Audio generation
   * never depends on ffmpeg — only this export-time mux does.
   */
  private async applySoundtrack(
    project: Project,
    outputPath: string,
    videoDurationSec: number | undefined,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<void> {
    const st = project.soundtrack;
    if (!st || (!st.musicAssetId && !st.narrationAssetId)) return;

    const findPath = (id?: string): string | undefined =>
      id ? project.assets.find((a) => a.id === id)?.path : undefined;
    const musicPath = findPath(st.musicAssetId);
    const narrationPath = findPath(st.narrationAssetId);
    if (!musicPath && !narrationPath) return; // referenced assets are gone

    onProgress?.(99, 'mixing audio');
    const { rename } = await import('node:fs/promises');
    const tmpOut = `${outputPath}.muxed.mp4`;
    // MiniMax music is a fixed ~50s clip regardless of request; `-shortest`
    // already trims it to the video length, but a hard cut sounds abrupt.
    // Default a gentle fade-out (≤ a third of the clip, capped 1.5s) when the
    // user hasn't set one and we know the video length.
    const defaultFadeOut =
      musicPath && videoDurationSec && videoDurationSec > 2
        ? Math.min(1.5, videoDurationSec / 3)
        : 0;
    const fadeOutSec = st.fadeOutSec ?? defaultFadeOut;
    await muxAudioWithFfmpeg({
      videoPath: outputPath,
      outputPath: tmpOut,
      ...(musicPath !== undefined && { musicPath }),
      ...(narrationPath !== undefined && { narrationPath }),
      ...(st.musicVolumeDb !== undefined && { musicVolumeDb: st.musicVolumeDb }),
      ...(st.narrationVolumeDb !== undefined && { narrationVolumeDb: st.narrationVolumeDb }),
      ...(st.fadeInSec !== undefined && { fadeInSec: st.fadeInSec }),
      ...(fadeOutSec > 0 && { fadeOutSec }),
      ...(videoDurationSec !== undefined && { videoDurationSec }),
    });
    await rename(tmpOut, outputPath);
  }
}

// ---------------------------------------------------------------------------
// ffmpeg concat helper
// ---------------------------------------------------------------------------

/**
 * Concatenate per-frame MP4 files into a single output using ffmpeg's concat
 * demuxer. Falls back to a no-op stub when frame list is empty (caller checks).
 *
 * Requires `ffmpeg` on PATH. Throws with a friendly hint if missing.
 */
async function concatFramesWithFfmpeg(
  frameMp4s: string[],
  outputPath: string,
  workDir: string,
): Promise<void> {
  if (frameMp4s.length === 0) {
    throw new HtmlVideoError('render-failed', 'No frames to concat');
  }
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');

  const listPath = join(workDir, 'frames', 'concat.txt');
  // ffmpeg concat demuxer wants each line: file '<absolute path>'
  const list = frameMp4s.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, list, 'utf8');

  await new Promise<void>((resolveFn, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        outputPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
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
            `ffmpeg concat exited with code ${code}: ${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

/**
 * Mix a background-music track and/or a narration track into a (silent) video
 * file, writing the result to `outputPath`. Video is stream-copied (no
 * re-encode); audio is encoded to AAC. Music is ducked under narration via a
 * volume offset, optional fade in/out is applied to the music, and `-shortest`
 * keeps the result aligned to the video length.
 *
 * `videoPath` and `outputPath` must differ. Throws HtmlVideoError on ffmpeg
 * failure; a missing ffmpeg yields the same friendly hint as concat.
 */
async function muxAudioWithFfmpeg(args: {
  videoPath: string;
  outputPath: string;
  musicPath?: string;
  narrationPath?: string;
  musicVolumeDb?: number;
  narrationVolumeDb?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  videoDurationSec?: number;
}): Promise<void> {
  const { spawn } = await import('node:child_process');
  const hasMusic = !!args.musicPath;
  const hasNarration = !!args.narrationPath;
  if (!hasMusic && !hasNarration) return; // nothing to mix

  const musicVol = args.musicVolumeDb ?? -18;
  const narrVol = args.narrationVolumeDb ?? 0;
  const fadeIn = args.fadeInSec ?? 0;
  const fadeOut = args.fadeOutSec ?? 0;

  // Inputs: [0] video, then music / narration in order.
  const inputs: string[] = ['-i', args.videoPath];
  let musicIdx = -1;
  let narrIdx = -1;
  let next = 1;
  if (hasMusic) { inputs.push('-i', args.musicPath!); musicIdx = next++; }
  if (hasNarration) { inputs.push('-i', args.narrationPath!); narrIdx = next++; }

  // Build a filter graph producing a single [aout] label.
  const filters: string[] = [];
  const mixLabels: string[] = [];
  if (hasMusic) {
    let chain = `[${musicIdx}:a]volume=${musicVol}dB`;
    if (fadeIn > 0) chain += `,afade=t=in:st=0:d=${fadeIn}`;
    // Fade-out only when we know where the end is.
    if (fadeOut > 0 && args.videoDurationSec && args.videoDurationSec > fadeOut) {
      chain += `,afade=t=out:st=${(args.videoDurationSec - fadeOut).toFixed(2)}:d=${fadeOut}`;
    }
    chain += '[bg]';
    filters.push(chain);
    mixLabels.push('[bg]');
  }
  if (hasNarration) {
    filters.push(`[${narrIdx}:a]volume=${narrVol}dB[vo]`);
    mixLabels.push('[vo]');
  }
  if (mixLabels.length === 2) {
    filters.push(`${mixLabels[0]}${mixLabels[1]}amix=inputs=2:duration=longest:dropout_transition=0[aout]`);
  } else {
    // single source → relabel to [aout]
    filters.push(`${mixLabels[0]}anull[aout]`);
  }

  const ffArgs = [
    '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    args.outputPath,
  ];

  await new Promise<void>((resolveFn, reject) => {
    const proc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new HtmlVideoError(
          'render-failed',
          'ffmpeg not found on PATH. Install with `brew install ffmpeg` (macOS) or your platform equivalent.',
        ));
      } else {
        reject(err);
      }
    });
    proc.on('exit', (code: number | null) => {
      if (code === 0) resolveFn();
      else reject(new HtmlVideoError('render-failed', `ffmpeg audio mux exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Append this export to the project's history (newest last, de-duped by path,
 *  capped so it doesn't grow unbounded). */
function recordExport(project: Project, outputPath: string): void {
  const list = (project.exports ?? []).filter((e) => e.path !== outputPath);
  list.push({ path: outputPath, filename: basename(outputPath), createdAt: new Date().toISOString() });
  // Keep the most recent 20.
  project.exports = list.slice(-20);
}

function templateRefFromMeta(meta: TemplateMetadata) {
  if (!meta.__dir) {
    throw new HtmlVideoError(
      'template-invalid',
      `Template ${meta.id} has no __dir set; was it loaded via TemplateRegistry?`,
    );
  }
  return {
    id: meta.id,
    engine: meta.engine,
    sourcePath: join(meta.__dir, meta.source_entry),
  };
}

function downgradeStatus(current: ProjectStatus, target: ProjectStatus): ProjectStatus {
  // After any modification, status should not be more advanced than 'draft'/given target.
  // 'rendered' / 'previewed' get demoted back to 'draft' on any meaningful change.
  if (target === 'draft') return 'draft';
  return current;
}

