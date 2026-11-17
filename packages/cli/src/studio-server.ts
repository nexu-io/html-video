/**
 * HTTP server for the project studio (RFC-05 §UI).
 * Serves @html-video/project-studio static UI + project / template REST APIs.
 */

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetStore, generateMusic, generateTts } from '@html-video/core';
import { detectAll, findAgent, spawnAgent } from '@html-video/runtime';
import type { CliContext } from './context.js';
import {
  type PhaseInputs,
  collectContentTurns,
  detectPhase,
  isControlPhrase,
  lastCardPickByPhase,
  resolveOpeningTopic,
} from './detect-phase.js';
import { extractUrls, fetchSource } from './fetch-source.js';
import {
  MIME,
  json,
  readBody,
  readBodyText,
  receiveMultipart,
  receiveMultipartFile,
  serveFile,
} from './studio-http.js';
import {
  extractContentGraphAndFrames,
  extractHtmlDocument,
  parseGraphJsonTolerant,
  summariseHtmlForIterate,
} from './studio-parse.js';
import {
  type Attachment,
  buildHtmlGenerationPrompt,
  buildStylePhasePrompt,
  partitionAttachments,
  renderAttachment,
  renderDesignSpecBlock,
} from './studio-prompt.js';
import { injectCompositionPlayer, templatePreviewMode } from './studio-template-preview.js';

export { parseFormatReply } from './detect-phase.js';
export { decodeUploadFilename } from './studio-http.js';

interface StudioHandle {
  url: string;
  port: number;
  close: () => void;
}

function resolveUiRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', 'project-studio', 'public'),
    resolve(here, '..', 'public'),
    resolve(here, '..', '..', 'storyboard-ui', 'public'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

export async function startStudioServer(ctx: CliContext, port: number): Promise<StudioHandle> {
  const uiRoot = resolveUiRoot();

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://x');
      const m = req.method ?? 'GET';

      // ============== API ==============

      // List projects
      if (url.pathname === '/api/projects' && m === 'GET') {
        const list = await ctx.orchestrator.list();
        return json(res, 200, { projects: list });
      }

      // Create project
      if (url.pathname === '/api/projects' && m === 'POST') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.create({
          name: (body.name as string) ?? 'Untitled',
          ...(body.intent !== undefined && { intent: body.intent as string }),
          preferences: (body.preferences as Record<string, unknown>) ?? {},
        });
        return json(res, 200, { project });
      }

      // Get / update / delete single project
      const projMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projMatch?.[1]) {
        const id = projMatch[1];
        if (m === 'GET') {
          return json(res, 200, { project: await ctx.orchestrator.load(id) });
        }
        if (m === 'PATCH') {
          const body = await readBody(req);
          const project = await ctx.orchestrator.load(id);
          if (typeof body.name === 'string' && body.name.trim()) {
            project.name = body.name.trim().slice(0, 80);
          }
          if (typeof body.intent === 'string') {
            project.intent = body.intent.slice(0, 280);
          }
          await ctx.projects.save(project);
          return json(res, 200, { project: await ctx.orchestrator.load(id) });
        }
        if (m === 'DELETE') {
          await ctx.orchestrator.remove(id);
          MESSAGES.delete(id);
          return json(res, 200, { ok: true });
        }
      }

      // List engines + templates
      if (url.pathname === '/api/templates' && m === 'GET') {
        return json(res, 200, {
          templates: ctx.templates.list().map((t) => {
            // Decide how the gallery should preview this template:
            //  - 'iframe'  → the entry HTML is self-contained; render it live.
            //  - 'poster'  → the entry only references sub-compositions via
            //    data-composition-src and needs the Hyperframes player (not yet
            //    built, v0.9) to show anything, so a live iframe is blank.
            //    Fall back to the shipped poster image instead.
            const { mode, posterUrl } = templatePreviewMode(t);
            const isNative = t.engine === 'remotion' && !!t.native?.compositionId;
            return {
              id: t.id,
              name: t.name,
              description: t.description,
              engine: t.engine,
              source_entry: t.source_entry,
              category: t.category,
              subcategory: t.subcategory,
              tags: t.tags,
              best_for: t.best_for,
              inputs_schema: t.inputs.schema,
              inputs_examples: t.inputs.examples,
              license: t.license,
              provenance: t.provenance,
              preview: t.preview,
              preview_mode: mode,
              poster_url: posterUrl,
              output: t.output,
              native: isNative,
              native_composition_id: t.native?.compositionId,
            };
          }),
        });
      }

      // Native Remotion templates for the per-frame enhance picker / format card.
      if (url.pathname === '/api/native-templates' && m === 'GET') {
        const natives = ctx.templates.listNative();
        return json(res, 200, {
          templates: natives.map((t) => {
            const { posterUrl } = templatePreviewMode(t);
            return {
              id: t.id,
              name: t.name,
              description: t.description,
              composition_id: t.native?.compositionId,
              category: t.category,
              subcategory: t.subcategory,
              tags: t.tags,
              best_for: t.best_for,
              poster_url: posterUrl,
            };
          }),
          default_id: natives.some((t) => t.id === 'frame-data-rollup')
            ? 'frame-data-rollup'
            : (natives[0]?.id ?? null),
        });
      }

      // Add asset (multipart-style via JSON for v0.1: paths or inline content)
      const addAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets$/);
      if (addAssetMatch?.[1] && m === 'POST') {
        const id = addAssetMatch[1];
        const ct = req.headers['content-type'] ?? '';
        let project: import('@html-video/core').Project | undefined;
        if (ct.startsWith('multipart/form-data')) {
          // Save uploaded file to /tmp then add
          const saved = await receiveMultipartFile(req, ct);
          project = await ctx.orchestrator.addFileAsset(id, saved.filePath);
        } else {
          const body = await readBody(req);
          if (body.kind === 'text') {
            project = await ctx.orchestrator.addInlineAsset(
              id,
              (body.content as string) ?? '',
              'text',
              body.caption as string | undefined,
            );
          } else if (body.kind === 'data') {
            project = await ctx.orchestrator.addInlineAsset(
              id,
              (body.content as string) ?? '',
              'data',
              body.caption as string | undefined,
            );
          } else if (body.kind === 'file' && body.path) {
            project = await ctx.orchestrator.addFileAsset(id, body.path as string);
          } else {
            return json(res, 400, { error: 'Provide kind=text|data|file with content/path' });
          }
        }
        return json(res, 200, { project });
      }

      // Remove asset
      const rmAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)$/);
      if (rmAssetMatch?.[1] && rmAssetMatch[2] && m === 'DELETE') {
        const project = await ctx.orchestrator.removeAsset(rmAssetMatch[1], rmAssetMatch[2]);
        return json(res, 200, { project });
      }

      // Set template
      const tplMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/template$/);
      if (tplMatch?.[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setTemplate(tplMatch[1], body.template_id as string);
        // Auto-seed preview with the template's own example.html so the user sees
        // something immediately (before any chat-driven rewrite).
        const tmpl = ctx.templates.get(body.template_id as string);
        const exampleHtmlPath = join(tmpl.__dir!, tmpl.source_entry);
        if (existsSync(exampleHtmlPath)) {
          const html = await readFile(exampleHtmlPath, 'utf8');
          await ctx.orchestrator.writePreviewHtmlRaw(project.id, html);
        }
        return json(res, 200, { project: await ctx.orchestrator.load(project.id) });
      }

      // Set agent (runtime selection)
      const agentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent$/);
      if (agentMatch?.[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setAgent(
          agentMatch[1],
          (body.agent_id as string) || null,
          body.agent_model === undefined ? undefined : (body.agent_model as string) || null,
        );
        return json(res, 200, { project });
      }

      // Set variables (whole bag)
      const varsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/variables$/);
      if (varsMatch?.[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setVariables(
          varsMatch[1],
          (body.variables as Record<string, unknown>) ?? {},
        );
        return json(res, 200, { project });
      }

      // Render preview HTML (legacy; v0.3+ uses chat-driven path)
      const prevMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/preview$/);
      if (prevMatch?.[1] && m === 'POST') {
        const { project, htmlPath } = await ctx.orchestrator.renderPreviewHtml(prevMatch[1]);
        return json(res, 200, {
          project,
          preview_url: `/preview/${project.id}`,
          html_path: htmlPath,
        });
      }

      // Get raw preview HTML (frontend reads to parse data-hv-text nodes)
      const rawGetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/raw-html$/);
      if (rawGetMatch?.[1] && m === 'GET') {
        const project = await ctx.orchestrator.load(rawGetMatch[1]);
        if (!project.lastPreviewHtmlPath || !existsSync(project.lastPreviewHtmlPath)) {
          return json(res, 404, {
            error: 'No preview HTML yet — pick a template or send a chat first',
          });
        }
        const html = await readFile(project.lastPreviewHtmlPath, 'utf8');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(html);
        return;
      }

      // Write raw preview HTML (frontend posts back the modified HTML
      // after the user edits a data-hv-text field in the middle column)
      if (rawGetMatch?.[1] && m === 'PUT') {
        const project = await ctx.orchestrator.load(rawGetMatch[1]);
        const ct = req.headers['content-type'] ?? '';
        let html: string;
        if (ct.includes('application/json')) {
          const body = await readBody(req);
          html = (body.html as string) ?? '';
        } else {
          html = await readBodyText(req);
        }
        if (!html || !/<\/html>/i.test(html)) {
          return json(res, 400, { error: 'Body must be a complete HTML document' });
        }
        await ctx.orchestrator.writePreviewHtmlRaw(project.id, html);
        return json(res, 200, { project: await ctx.orchestrator.load(project.id) });
      }

      // Frame-specific raw HTML — keeps frames[] intact (writePreviewHtmlRaw
      // resets the storyboard, which is wrong for multi-frame edits).
      const frameRawMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/raw-html$/,
      );
      if (frameRawMatch?.[1] && frameRawMatch[2]) {
        const projId = frameRawMatch[1];
        const nodeId = frameRawMatch[2];
        if (m === 'GET') {
          const project = await ctx.orchestrator.load(projId);
          const frame = (project.frames ?? []).find((f) => f.graphNodeId === nodeId);
          if (!frame || !existsSync(frame.htmlPath)) {
            return json(res, 404, { error: `Frame ${nodeId} not found` });
          }
          const html = await readFile(frame.htmlPath, 'utf8');
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(html);
          return;
        }
        if (m === 'PUT') {
          const ct = req.headers['content-type'] ?? '';
          let html: string;
          if (ct.includes('application/json')) {
            const body = await readBody(req);
            html = (body.html as string) ?? '';
          } else {
            html = await readBodyText(req);
          }
          if (!html || !/<\/html>/i.test(html)) {
            return json(res, 400, { error: 'Body must be a complete HTML document' });
          }
          await ctx.orchestrator.writeFrameHtml(projId, nodeId, html);
          return json(res, 200, { ok: true });
        }
      }

      // Enhance a data frame with a native Remotion template (user-initiated
      // motion enhancement, RFC-08/09). Sets the frame's engine + renders a
      // short single-frame preview MP4 so the studio can play the native
      // animation before a full export. Streams SSE progress like export.
      const enhMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/enhance$/);
      if (enhMatch?.[1] && enhMatch[2] && m === 'POST') {
        const projectId = enhMatch[1];
        const nodeId = enhMatch[2];
        const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
        const requested = typeof body.nativeTemplateId === 'string' ? body.nativeTemplateId : '';
        const natives = ctx.templates.listNative();
        const nativeTemplateId =
          (requested && natives.some((t) => t.id === requested) ? requested : null) ??
          (natives.some((t) => t.id === 'frame-data-rollup')
            ? 'frame-data-rollup'
            : natives[0]?.id);
        if (!nativeTemplateId) {
          return json(res, 400, {
            error: 'No native Remotion templates are installed',
          });
        }
        const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
        if (!wantsStream) {
          try {
            await ctx.orchestrator.enhanceFrameNative(projectId, nodeId, nativeTemplateId);
            const { project } = await ctx.orchestrator.renderFrameNativePreview({
              projectId,
              graphNodeId: nodeId,
            });
            return json(res, 200, { ok: true, project, node_id: nodeId });
          } catch (err) {
            return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const sse = (obj: unknown) => {
          try {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
          } catch {
            /* client gone — work keeps running, result is persisted */
          }
        };
        const t0 = Date.now();
        try {
          sse({ type: 'enhance_started' });
          sse({ type: 'enhance_progress', pct: 5, stage: 'preparing' });
          await ctx.orchestrator.enhanceFrameNative(projectId, nodeId, nativeTemplateId);
          const { project } = await ctx.orchestrator.renderFrameNativePreview({
            projectId,
            graphNodeId: nodeId,
            onProgress: (pct, stage) => sse({ type: 'enhance_progress', pct, stage }),
          });
          const ms = Date.now() - t0;
          process.stderr.write(
            `[studio:enhance] proj=${projectId} frame=${nodeId} done in ${ms}ms\n`,
          );
          sse({ type: 'enhance_done', project, node_id: nodeId, elapsed_ms: ms });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[studio:enhance] proj=${projectId} frame=${nodeId} failed: ${msg}\n`,
          );
          sse({ type: 'enhance_failed', message: msg });
        }
        res.end();
        return;
      }

      // Revert a frame's native enhancement back to its base hyperframes HTML.
      // Instant (no render) — the original HTML at frame.htmlPath is untouched.
      const unenhMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/unenhance$/,
      );
      if (unenhMatch?.[1] && unenhMatch[2] && m === 'POST') {
        try {
          const { project } = await ctx.orchestrator.unenhanceFrame(unenhMatch[1], unenhMatch[2]);
          return json(res, 200, { ok: true, project, node_id: unenhMatch[2] });
        } catch (err) {
          return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Export MP4 — streams progress via SSE so the user sees per-frame
      // recording status during a multi-minute multi-frame export.
      const expMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
      if (expMatch?.[1] && m === 'POST') {
        const projectId = expMatch[1];
        // The studio uses the SSE branch by default. A plain POST (curl /
        // tests) gets the legacy blocking response.
        const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
        if (!wantsStream) {
          try {
            const { project, outputPath } = await ctx.orchestrator.exportMp4({ projectId });
            return json(res, 200, { project, output_path: outputPath });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return json(res, 500, { error: msg });
          }
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const sse = (obj: unknown) => {
          try {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
          } catch {
            /* client gone — generation keeps running, result is persisted */
          }
        };
        const t0 = Date.now();
        try {
          sse({ type: 'export_started' });
          const { project, outputPath } = await ctx.orchestrator.exportMp4({
            projectId,
            onProgress: (pct, stage) => {
              sse({ type: 'export_progress', pct, stage });
            },
          });
          const ms = Date.now() - t0;
          process.stderr.write(
            `[studio:export] proj=${projectId} done in ${ms}ms → ${outputPath}\n`,
          );
          sse({ type: 'export_done', output_path: outputPath, project, elapsed_ms: ms });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[studio:export] proj=${projectId} failed: ${msg}\n`);
          sse({ type: 'export_failed', message: msg });
        }
        res.end();
        return;
      }

      // Generate soundtrack: background music (MiniMax music_generation) and/or
      // narration (MiniMax t2a_v2). Streams SSE progress like export. The
      // generated MP3s are stored as project assets; their ids land in
      // project.soundtrack so exportMp4 mixes them in. Generation itself does
      // NOT need ffmpeg — only the export-time mux does.
      const genAudioMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/generate-audio$/);
      if (genAudioMatch?.[1] && m === 'POST') {
        const projectId = genAudioMatch[1];
        const body = (await readBody(req)) as {
          music?: { prompt?: string; instrumental?: boolean; volumeDb?: number };
          narration?: {
            text?: string;
            voiceId?: string;
            volumeDb?: number;
            languageBoost?: string;
            byFrame?: Record<string, string>;
          };
          fadeInSec?: number;
          fadeOutSec?: number;
        };
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const sse = (obj: unknown) => {
          try {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
          } catch {
            /* client gone — generation keeps running, result is persisted */
          }
        };
        try {
          sse({ type: 'audio_started' });
          const creds = ctx.mediaConfig.resolveMinimax();
          if (!creds) {
            sse({
              type: 'audio_failed',
              message:
                'MiniMax API key not configured — add it in Settings → Audio (or set OD_MINIMAX_API_KEY).',
            });
            res.end();
            return;
          }

          const project = await ctx.orchestrator.load(projectId);
          const soundtrack = { ...(project.soundtrack ?? {}) };
          const wantMusic = !!body.music?.prompt?.trim();
          const wantNarration = !!body.narration?.text?.trim();
          if (!wantMusic && !wantNarration) {
            sse({
              type: 'audio_failed',
              message: 'Nothing to generate — provide a music prompt and/or narration text.',
            });
            res.end();
            return;
          }

          if (wantMusic) {
            const musicPrompt = body.music!.prompt!.trim();
            sse({
              type: 'audio_progress',
              stage: 'music',
              message: 'generating background music…',
            });
            const music = await generateMusic({
              prompt: musicPrompt,
              instrumental: body.music?.instrumental ?? true,
              creds,
            });
            const { asset } = await ctx.orchestrator.addBufferAsset(
              projectId,
              music.bytes,
              music.ext,
              `background music · ${musicPrompt.slice(0, 60)}`,
            );
            soundtrack.musicAssetId = asset.id;
            soundtrack.musicPrompt = musicPrompt;
            if (body.music?.volumeDb !== undefined) soundtrack.musicVolumeDb = body.music?.volumeDb;
            sse({
              type: 'audio_progress',
              stage: 'music',
              message: music.providerNote,
              asset_id: asset.id,
            });
          }

          if (wantNarration) {
            const narrationText = body.narration!.text!.trim();
            sse({ type: 'audio_progress', stage: 'narration', message: 'generating narration…' });
            const nar = await generateTts({
              text: narrationText,
              ...(body.narration?.voiceId !== undefined && { voiceId: body.narration?.voiceId }),
              ...(body.narration?.languageBoost !== undefined && {
                languageBoost: body.narration?.languageBoost,
              }),
              creds,
            });
            const { asset } = await ctx.orchestrator.addBufferAsset(
              projectId,
              nar.bytes,
              nar.ext,
              `narration · ${body.narration?.text?.trim().slice(0, 60)}`,
            );
            soundtrack.narrationAssetId = asset.id;
            soundtrack.narrationText = body.narration?.text?.trim();
            if (body.narration?.byFrame) soundtrack.narrationByFrame = body.narration?.byFrame;
            if (body.narration?.volumeDb !== undefined)
              soundtrack.narrationVolumeDb = body.narration?.volumeDb;
            sse({
              type: 'audio_progress',
              stage: 'narration',
              message: nar.providerNote,
              asset_id: asset.id,
            });
          }

          if (body.fadeInSec !== undefined) soundtrack.fadeInSec = body.fadeInSec;
          if (body.fadeOutSec !== undefined) soundtrack.fadeOutSec = body.fadeOutSec;

          // Persist soundtrack onto the project (reload to avoid clobbering the
          // asset pushes addBufferAsset already saved).
          const fresh = await ctx.orchestrator.load(projectId);
          fresh.soundtrack = soundtrack;
          await ctx.projects.save(fresh);
          sse({ type: 'audio_done', project: fresh, soundtrack });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[studio:generate-audio] proj=${projectId} failed: ${msg}\n`);
          sse({ type: 'audio_failed', message: msg });
        }
        res.end();
        return;
      }

      // Draft a narration script from the project's already-generated frames.
      // Reads the content-graph (per-frame text) and asks the agent for a short
      // spoken voiceover IN THE SAME LANGUAGE as that text. Returns plain JSON
      // { narration } — the user edits it before generating audio.
      const draftNarrMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/draft-narration$/);
      if (draftNarrMatch?.[1] && m === 'POST') {
        const projectId = draftNarrMatch[1];
        try {
          // body.frameId set → draft ONLY that frame (single-frame regenerate).
          // unset → draft every frame (global). Either way returns a per-frame map.
          const body = (await readBody(req)) as { agentId?: string; frameId?: string };
          const graph = await ctx.orchestrator.readContentGraph(projectId);
          if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
            return json(res, 400, { error: 'No frames yet — generate the video first.' });
          }
          if (!body.agentId) return json(res, 400, { error: 'No agent selected.' });
          const agentDef = findAgent(body.agentId);
          if (!agentDef) return json(res, 400, { error: `agent "${body.agentId}" not registered` });
          const projectDir = await ctx.projects.ensureDir(projectId);
          // Only TextNode carries copy; fall back to label/id for entity/data.
          const nodeText = (n: (typeof graph.nodes)[number]): string =>
            (n.kind === 'text' ? n.text : undefined) ?? n.label ?? n.id;
          const allFrames = graph.nodes.map((n, i) => ({
            id: n.id,
            idx: i,
            text: nodeText(n).replace(/\n/g, ' ').slice(0, 240),
          }));
          const frameLines = allFrames.map((f) => `${f.idx + 1}. ${f.text}`).join('\n');

          const narrationByFrame: Record<string, string> = {};

          if (body.frameId) {
            // ---- single frame: narrate just this one, with the rest as context ----
            const target = allFrames.find((f) => f.id === body.frameId);
            if (!target)
              return json(res, 400, { error: `frame "${body.frameId}" not in content-graph` });
            const prompt = [
              `This is a ${allFrames.length}-frame video. Write the spoken NARRATION for FRAME ${target.idx + 1} ONLY.`,
              '',
              'All frames (for context):',
              frameLines,
              '',
              graph.synopsis ? `Synopsis: ${graph.synopsis}` : '',
              '',
              `Write ONE short spoken sentence narrating frame ${target.idx + 1} ("${target.text}") specifically — distinct, not generic.`,
              'Same language as the frame text. Plain text only: just the sentence, no numbering, quotes, or markdown.',
            ]
              .filter((l) => l !== undefined)
              .join('\n');
            const raw = (await callAgentSimple(agentDef, prompt, projectDir)).trim();
            const line =
              raw
                .split('\n')
                .map((l) => l.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim())
                .find((l) => l.length > 0) ?? raw;
            narrationByFrame[target.id] = line;
          } else {
            // ---- global: one line per frame, in order ----
            const prompt = [
              `Write a spoken NARRATION script for this ${allFrames.length}-frame video — ONE line per frame, IN FRAME ORDER.`,
              '',
              'Frames (in order):',
              frameLines,
              '',
              graph.synopsis ? `Synopsis: ${graph.synopsis}` : '',
              '',
              'Rules:',
              `- Output EXACTLY ${allFrames.length} lines, one per frame, in the SAME order. Line 1 narrates frame 1, etc.`,
              `- Each line is ONE short spoken sentence about THAT specific frame's content — distinct per frame, not a generic restatement.`,
              '- The lines should still flow as a continuous voiceover read top to bottom.',
              '- Same language as the frame text. Plain text only: one sentence per line, no numbering, bullets, blank lines, or markdown.',
            ]
              .filter((l) => l !== undefined)
              .join('\n');
            const raw = (await callAgentSimple(agentDef, prompt, projectDir)).trim();
            const lines = raw
              .split('\n')
              .map((l) => l.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim())
              .filter((l) => l.length > 0);
            // Map lines onto frames positionally; if the model under/over-produced,
            // pair as far as they line up and leave the rest blank.
            allFrames.forEach((f, i) => {
              if (lines[i]) narrationByFrame[f.id] = lines[i]!;
            });
          }
          return json(res, 200, { narrationByFrame });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[studio:draft-narration] proj=${projectId} failed: ${msg}\n`);
          return json(res, 500, { error: msg });
        }
      }

      // Clear a project's soundtrack (keeps the asset files, just drops the
      // references so the next export has no audio).
      const clearAudioMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/soundtrack$/);
      if (clearAudioMatch?.[1] && m === 'DELETE') {
        const project = await ctx.orchestrator.load(clearAudioMatch[1]);
        project.soundtrack = undefined;
        await ctx.projects.save(project);
        return json(res, 200, { project });
      }

      // Reveal an exported file in the OS file browser. macOS: `open -R`
      // opens Finder with the file selected. Other platforms fall through
      // to a plain `open` which the OS handles best-effort.
      const revealMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reveal$/);
      if (revealMatch?.[1] && m === 'POST') {
        const project = await ctx.orchestrator.load(revealMatch[1]);
        const target = project.lastOutputMp4Path;
        if (!target || !existsSync(target)) {
          return json(res, 404, { error: 'No exported MP4 to reveal' });
        }
        const { spawn } = await import('node:child_process');
        const platform = process.platform;
        const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
        const args = platform === 'darwin' ? ['-R', target] : [target];
        spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
        return json(res, 200, { ok: true, target, platform });
      }

      // MiniMax audio API config — GET status (masked), POST to save, DELETE to clear.
      // Lets users configure the key in the Settings UI instead of env vars.
      if (url.pathname === '/api/config/minimax' && m === 'GET') {
        return json(res, 200, ctx.mediaConfig.getMinimaxStatus());
      }
      if (url.pathname === '/api/config/minimax' && m === 'POST') {
        const body = (await readBody(req)) as { apiKey?: string; baseUrl?: string };
        const key = (body.apiKey ?? '').trim();
        if (!key) return json(res, 400, { error: 'apiKey is required' });
        ctx.mediaConfig.setMinimax(key, body.baseUrl);
        return json(res, 200, ctx.mediaConfig.getMinimaxStatus());
      }
      if (url.pathname === '/api/config/minimax' && m === 'DELETE') {
        ctx.mediaConfig.clearMinimax();
        return json(res, 200, ctx.mediaConfig.getMinimaxStatus());
      }

      // Agents (detected on each call; cheap thanks to the in-process cache)
      if (url.pathname === '/api/agents' && m === 'GET') {
        const force = url.searchParams.get('force') === '1';
        const agents = await detectAll(force ? { force: true } : undefined);
        return json(res, 200, { agents });
      }

      // Agent models — currently AMR only. Lists the live `vela model list`
      // catalog so the UI can offer a model picker (deepseek/claude/gpt/…).
      const modelsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/models$/);
      if (modelsMatch?.[1] && m === 'GET') {
        const agentId = modelsMatch[1];
        if (agentId !== 'amr') return json(res, 200, { models: [] });
        const def = findAgent(agentId);
        if (!def) return json(res, 404, { error: `agent "${agentId}" not registered` });
        const { resolveBin, listAmrModels } = await import('@html-video/runtime');
        const bin = await resolveBin(def);
        if (!bin) return json(res, 400, { error: 'vela binary not found' });
        try {
          const models = await listAmrModels(bin);
          return json(res, 200, { models, default: def.defaultModel ?? null });
        } catch (err) {
          return json(res, 200, {
            models: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Agent login — currently AMR/vela only. Spawns `vela login`, which opens
      // the browser for OAuth; we wait for the process to exit (auth complete or
      // cancelled). The user signs in with their OWN Open Design account.
      const loginMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/login$/);
      if (loginMatch?.[1] && m === 'POST') {
        const agentId = loginMatch[1];
        if (agentId !== 'amr')
          return json(res, 400, { error: `agent "${agentId}" has no login flow` });
        const def = findAgent(agentId);
        if (!def) return json(res, 404, { error: `agent "${agentId}" not registered` });
        const { resolveBin } = await import('@html-video/runtime');
        const bin = await resolveBin(def);
        if (!bin) return json(res, 400, { error: 'vela binary not found' });
        try {
          const { spawn } = await import('node:child_process');
          const code = await new Promise<number>((resolveCode, rejectCode) => {
            const child = spawn(bin, ['login'], { stdio: 'ignore' });
            // vela login opens the browser itself; it exits once auth completes
            // or is cancelled. Cap the wait so a never-finished login can't hang.
            const timer = setTimeout(() => {
              try {
                child.kill('SIGTERM');
              } catch {
                /* */
              }
              rejectCode(new Error('login timed out (5 min)'));
            }, 5 * 60_000);
            child.on('error', (e: Error) => {
              clearTimeout(timer);
              rejectCode(e);
            });
            child.on('exit', (c: number | null) => {
              clearTimeout(timer);
              resolveCode(c ?? -1);
            });
          });
          if (code !== 0)
            return json(res, 400, { ok: false, error: `vela login exited with code ${code}` });
          // Re-detect (force) so the agent flips to available immediately.
          const agents = await detectAll({ force: true });
          const amr = agents.find((a) => a.id === 'amr');
          return json(res, 200, {
            ok: !!amr?.available,
            available: !!amr?.available,
            ...(amr?.hint && { hint: amr.hint }),
          });
        } catch (err) {
          return json(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Agent smoke test — fires a tiny prompt at the requested agent and
      // reports timing + bytes. Used by the Settings modal so the user can
      // confirm a CLI is actually responding (not just on PATH).
      const testMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/test$/);
      if (testMatch?.[1] && m === 'POST') {
        const agentId = testMatch[1];
        const def = findAgent(agentId);
        if (!def) return json(res, 404, { error: `agent "${agentId}" not registered` });
        const prompt = 'Reply with one word: hello.';
        const t0 = Date.now();
        let out = '';
        let err = '';
        const handle = spawnAgent({
          def,
          prompt,
          context: { cwd: process.cwd() },
          onEvent: (ev) => {
            if (ev.type === 'text') out += ev.chunk;
            else if (ev.type === 'error') err = ev.message;
          },
        });
        const exit = await handle.done;
        return json(res, 200, {
          ok: exit.exitCode === 0 && out.trim().length > 0,
          exit_code: exit.exitCode,
          ms: Date.now() - t0,
          bytes: out.length,
          stdout_head: out.slice(0, 200),
          error: err || (out.trim().length === 0 ? 'empty reply' : undefined),
        });
      }

      // Messages: GET history (lazy-loads from messages.json on first hit)
      const msgsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages$/);
      if (msgsMatch?.[1] && m === 'GET') {
        const arr = await loadMessages(ctx, msgsMatch[1]);
        return json(res, 200, { messages: arr });
      }

      // Messages: POST = send + stream agent reply via SSE
      // v0.5: accepts multipart (text + files) OR JSON. Files become real
      // project assets via AssetStore; their paths are passed to the agent
      // prompt as attachments.
      if (msgsMatch?.[1] && m === 'POST') {
        const id = msgsMatch[1];
        const ct = req.headers['content-type'] ?? '';
        let userText = '';
        let focusFrameId = '';
        const attachments: Attachment[] = [];

        const project0 = await ctx.orchestrator.load(id);
        if (ct.startsWith('multipart/form-data')) {
          const parts = await receiveMultipart(req, ct);
          for (const p of parts) {
            if (p.kind === 'field' && p.name === 'content') {
              userText = p.value;
            } else if (p.kind === 'field' && p.name === 'focus_frame_id') {
              focusFrameId = p.value;
            } else if (p.kind === 'file') {
              const updatedProject = await ctx.orchestrator.addFileAsset(id, p.tmpPath);
              const newAsset = updatedProject.assets[updatedProject.assets.length - 1];
              if (newAsset) {
                const att: Attachment = {
                  path: newAsset.path ?? p.tmpPath,
                  kind: newAsset.type as Attachment['kind'],
                  filename: p.filename,
                  size: newAsset.metadata.sizeBytes ?? 0,
                };
                // Inline small text/data uploads so the agent (incl. HTTP ones)
                // actually sees the content, not just a local path.
                if ((newAsset.type === 'text' || newAsset.type === 'data') && newAsset.path) {
                  try {
                    const txt = await readFile(newAsset.path, 'utf8');
                    if (txt.length <= 20_000) att.inlineText = txt;
                  } catch {
                    /* fall back to path-only */
                  }
                }
                attachments.push(att);
              }
            }
          }
        } else {
          const body = await readBody(req);
          userText = (body.content as string) ?? '';
          focusFrameId = (body.focus_frame_id as string) ?? '';
        }

        if (!userText && attachments.length === 0) {
          return json(res, 400, { error: 'content or attachments required' });
        }

        // External content sources: any URL (web article or GitHub repo) in the
        // user's message is fetched server-side and turned into a text asset, so
        // the offline agent can base the video on it. Reuses the attachment
        // pipeline (kind:'text' flows into the prompt downstream). Lossless
        // degradation: a fetch that fails is logged and skipped, never a 400.
        for (const sourceUrl of extractUrls(userText)) {
          try {
            const src = await fetchSource(sourceUrl);
            const label = src.kind === 'repo' ? 'GitHub repo' : 'Web article';
            const updated = await ctx.orchestrator.addInlineAsset(
              id,
              src.markdown,
              'text',
              `${label}: ${src.title || sourceUrl}`,
            );
            const asset = updated.assets[updated.assets.length - 1];
            if (asset?.path) {
              let host = sourceUrl;
              try {
                host = new URL(sourceUrl).hostname;
              } catch {
                /* keep raw */
              }
              attachments.push({
                path: asset.path,
                kind: 'text',
                filename: `${host}.md`,
                size: src.markdown.length,
                inlineText: src.markdown,
              });
              process.stderr.write(
                `[studio:fetch-source] ${src.kind} ${sourceUrl} → ${src.markdown.length} chars${src.truncated ? ' (truncated)' : ''}\n`,
              );
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`[studio:fetch-source] skip ${sourceUrl}: ${msg}\n`);
          }
        }

        // Re-fetch project after potential addFileAsset side-effects
        const project = await ctx.orchestrator.load(id);
        const tmpl = project.templateId ? ctx.templates.get(project.templateId) : null;
        // No template required — agent can synthesize from scratch when none picked.

        // Resolve the agent. Pinned project agent wins. Otherwise pick the first
        // available agent that needs no extra setup (skip AMR — it's available
        // but billed/needs balance, so it must be an explicit choice, not a
        // silent default). anthropic-api is the final HTTP fallback. This keeps
        // "what the toolbar shows" === "what actually runs".
        let agentId = project.agentId;
        if (!agentId) {
          const detected = await detectAll();
          // Prefer a real, ready-to-run CLI agent (claude/codex/…). Only fall
          // back to anthropic-api if it's actually configured (has a key) —
          // otherwise picking it would fail mid-flow with "No ANTHROPIC_API_KEY"
          // on a later turn (e.g. after the detect cache expires and a transient
          // probe miss drops the CLI agent). Persist the choice so every
          // subsequent turn in this project uses the same agent, not whatever
          // a fresh probe happens to return.
          const ready = detected.filter((a) => a.available && a.id !== 'amr');
          const apiReady = ready.find((a) => a.id === 'anthropic-api');
          agentId =
            ready.find((a) => a.id !== 'anthropic-api')?.id ??
            apiReady?.id ??
            'anthropic-api';
          if (project.agentId !== agentId) {
            try {
              await ctx.orchestrator.setAgent(id, agentId, undefined);
            } catch {
              /* persist is best-effort; resolution above still holds for this turn */
            }
          }
        }
        const agentDef = findAgent(agentId);
        if (!agentDef) {
          return json(res, 400, { error: `agent "${agentId}" not registered` });
        }
        // Model the user picked for this agent (AMR); undefined → agent default.
        const agentModel = project.agentModel ?? undefined;

        // Append user message to history (with attachment summary)
        const attachmentSummary =
          attachments.length > 0
            ? `\n\n📎 ${attachments.length} attachment(s): ${attachments.map((a) => a.filename).join(', ')}`
            : '';
        const history = await loadMessages(ctx, id);
        history.push({
          role: 'user',
          content: userText + attachmentSummary,
          ts: Date.now(),
        });
        MESSAGES.set(id, history);
        // Persist immediately so the user message survives even if the
        // streaming agent call below crashes mid-flight.
        await saveMessages(ctx, id, history);

        // Compose prompt — template-aware OR template-free
        const projectDir = await ctx.projects.ensureDir(id);
        // Frame focus: when iterating, the user can pin a specific frame
        // so the next turn only rewrites that frame's HTML instead of the
        // whole-project preview.html.
        const focusFrame = focusFrameId
          ? (project.frames ?? []).find((f) => f.graphNodeId === focusFrameId)
          : undefined;
        const focusFrameHtml =
          focusFrame && existsSync(focusFrame.htmlPath)
            ? await readFile(focusFrame.htmlPath, 'utf8')
            : '';
        const priorHtmlPath = join(projectDir, 'preview.html');
        const priorHtml =
          focusFrameHtml ||
          (existsSync(priorHtmlPath) ? await readFile(priorHtmlPath, 'utf8') : '');
        let exampleHtml = '';
        if (tmpl) {
          const exampleHtmlPath = join(tmpl.__dir!, tmpl.source_entry);
          if (existsSync(exampleHtmlPath)) {
            exampleHtml = await readFile(exampleHtmlPath, 'utf8');
          }
        }

        // Carry source material across turns: a link/file is usually attached
        // on an early turn (e.g. while picking a content type), but generation
        // happens several turns later with no attachment on that request. Merge
        // the project's stored text/data assets (fetched articles/repos,
        // uploaded docs) into this turn's attachments so they reach the prompt.
        const seenPaths = new Set(attachments.map((a) => a.path));
        for (const asset of project.assets) {
          if (
            (asset.type === 'text' || asset.type === 'data') &&
            asset.path &&
            !seenPaths.has(asset.path)
          ) {
            let inlineText: string | undefined;
            try {
              const txt = await readFile(asset.path, 'utf8');
              if (txt.length <= 20_000) inlineText = txt;
            } catch {
              /* path-only fallback */
            }
            attachments.push({
              path: asset.path,
              kind: asset.type as Attachment['kind'],
              filename: asset.metadata.filename ?? `${asset.type}-${asset.id.slice(0, 8)}`,
              size: asset.metadata.sizeBytes ?? 0,
              ...(inlineText !== undefined && { inlineText }),
            });
            seenPaths.add(asset.path);
          }
        }

        const fullPrompt = buildHtmlGenerationPrompt({
          tmpl,
          exampleHtml,
          priorHtml,
          history,
          userText,
          attachments,
          focusFrameId: focusFrameId || undefined,
          openingTopic: resolveOpeningTopic(project, history),
        });
        const phaseInfo = detectPhase(
          history,
          userText,
          !!project.templateId,
          attachments.some((a) => !!a.inlineText),
          focusFrameId,
        );
        const t0 = Date.now();
        // Save the prompt next to the project so we can inspect what we sent.
        // Also dump the previous one as .prev for diffing across turns.
        const promptDumpPath = join(projectDir, 'last-prompt.txt');
        try {
          if (existsSync(promptDumpPath)) {
            const prev = await readFile(promptDumpPath, 'utf8');
            const fs = await import('node:fs/promises');
            await fs.writeFile(join(projectDir, 'last-prompt.prev.txt'), prev, 'utf8');
          }
          const fs = await import('node:fs/promises');
          await fs.writeFile(promptDumpPath, fullPrompt, 'utf8');
        } catch {
          /* non-fatal */
        }
        process.stderr.write(
          `[studio:msg] proj=${id} phase=${phaseInfo.phase} prompt=${fullPrompt.length}B user=${JSON.stringify(userText.slice(0, 80))} attachments=${attachments.length}\n`,
        );

        // Mark this project as generating so a returning client knows the task
        // is still alive. Cleared in the finally below (covers all exit paths).
        GENERATING.add(id);
        try {
          // SSE response
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });

          // Tolerant write: if the client navigated away (switched project) the
          // socket is gone and res.write throws. Swallow it so generation keeps
          // running to completion and still persists to messages.json — the user
          // sees the finished result when they come back, instead of a killed task.
          const sseWrite = (obj: unknown) => {
            try {
              if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
            } catch {
              /* client disconnected — keep generating, result is persisted below */
            }
          };

          let assistantText = '';
          let textChunks = 0;
          let summaryLine = '';

          // ---- generate-phase: multi-frame path runs split (graph + per-frame) ----
          // Empirically claude --print returns 1 byte ~50% of the time when asked
          // to emit a graph and 4-6 full HTML pages in a single response. Each
          // call individually is reliable, so we orchestrate them ourselves and
          // stream progress events to the UI.
          const isMultiGenerate =
            phaseInfo.phase === 'generate' &&
            Number(phaseInfo.inputs.collected?.frame_count ?? '1') > 1;

          // Post-generation iteration: the card-driven sub-flow resolved to a
          // concrete change. Re-use the existing storyboard rather than guessing.
          //   restyle         → keep graph text, re-render every frame in the newly
          //                      picked style.
          //   iterate-content → re-plan the whole storyboard around new content.
          //   iterate-format  → re-time and re-render with the new per-frame length.
          const isMultiFrameProject =
            (project.frames ?? []).length > 1 ||
            Number(phaseInfo.inputs.collected?.frame_count ?? '1') > 1;
          let rewriteInputs: PhaseInputs | undefined;
          let restyleOnly = false;
          if (phaseInfo.phase === 'restyle' && isMultiFrameProject) {
            // Keep text, change visual style. pickedStyle is the user's new pick.
            restyleOnly = true;
            rewriteInputs = {
              ...phaseInfo.inputs,
              pickedType: lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType,
              pickedStyle: phaseInfo.inputs.pickedStyle || userText.trim(),
              contentTurns: collectContentTurns(history),
            };
          } else if (phaseInfo.phase === 'iterate-content' && isMultiFrameProject) {
            // Re-plan around the user's new content instruction.
            const turns = [...collectContentTurns(history), userText].filter(
              (s) => !isControlPhrase(s),
            );
            rewriteInputs = {
              ...phaseInfo.inputs,
              pickedType: lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType,
              pickedStyle:
                lastCardPickByPhase(history, 'style') ?? phaseInfo.inputs.pickedStyle ?? '',
              contentTurns: turns,
            };
          } else if (phaseInfo.phase === 'iterate-format' && isMultiFrameProject) {
            // New per-frame timing was submitted; keep content + style, re-render.
            restyleOnly = true; // reuse the existing graph text; only timing/visual recompute
            rewriteInputs = {
              ...phaseInfo.inputs,
              pickedType: lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType,
              pickedStyle:
                lastCardPickByPhase(history, 'style') ?? phaseInfo.inputs.pickedStyle ?? '',
              contentTurns: collectContentTurns(history),
            };
          }

          if (isMultiGenerate || rewriteInputs) {
            if (rewriteInputs) {
              const n =
                (project.frames ?? []).length ||
                Number(phaseInfo.inputs.collected?.frame_count ?? '3');
              const notice = restyleOnly
                ? `🎨 沿用文案，按新风格重做全部 ${n} 帧…\n`
                : `🔄 基于新内容重做全部 ${n} 帧（已手动修改过的帧会被覆盖）…\n`;
              assistantText += notice;
              sseWrite({ type: 'text', chunk: notice });
            }
            try {
              const result = await runSplitMultiFrameGenerate({
                ctx,
                projectId: id,
                projectDir,
                agentDef,
                agentModel,
                tmpl,
                priorHtml,
                inputs: rewriteInputs ?? phaseInfo.inputs,
                attachments,
                openingTopic: resolveOpeningTopic(project, history),
                restyleOnly,
                onProgress: (msg) => {
                  assistantText += `${msg}\n`;
                  textChunks += 1;
                  sseWrite({ type: 'text', chunk: `${msg}\n` });
                },
                onSse: sseWrite,
              });
              summaryLine = rewriteInputs
                ? `✓ ${result.frameCount}-frame storyboard ${restyleOnly ? 'restyled' : 'regenerated'} (intent: ${result.intent})`
                : `✓ ${result.frameCount}-frame storyboard generated (intent: ${result.intent})`;
              sseWrite({
                type: 'preview_ready',
                preview_url: `/preview/${id}`,
                frames: result.frameCount,
              });
              sseWrite({ type: 'message_end', reason: 'ok' });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[studio:msg] proj=${id} split-generate failed: ${msg}\n`);
              sseWrite({ type: 'text', chunk: `\n⚠️ Split generate failed: ${msg}` });
              sseWrite({ type: 'message_end', reason: 'error' });
              assistantText = `⚠️ Split generate failed: ${msg}`;
            }
            process.stderr.write(
              `[studio:msg] proj=${id} phase=split-generate done text=${assistantText.length}B\n`,
            );
          } else {
            // ---- single-shot path (all other phases + single-frame generate) ----
            const handle = spawnAgent({
              def: agentDef,
              prompt: fullPrompt,
              context: { cwd: projectDir, ...(agentModel && { model: agentModel }) },
              onEvent: (ev) => {
                if (ev.type === 'text') {
                  assistantText += ev.chunk;
                  textChunks += 1;
                  sseWrite(ev);
                } else if (ev.type === 'error' || ev.type === 'message_end') {
                  if (ev.type === 'error') {
                    process.stderr.write(`[studio:msg] proj=${id} agent-error: ${ev.message}\n`);
                  }
                  sseWrite(ev);
                }
              },
            });
            const exitInfo = await handle.done;
            const elapsedMs = Date.now() - t0;
            process.stderr.write(
              `[studio:msg] proj=${id} phase=${phaseInfo.phase} done in ${elapsedMs}ms exit=${exitInfo.exitCode} text=${assistantText.length}B chunks=${textChunks}\n`,
            );

            // Empty-reply retry: if the agent returned almost nothing AND we
            // were on the iterate path with prior HTML, try a tighter prompt
            // that only ships the user's request + a tiny instruction. This
            // catches the 6-8KB-prompt empty-reply mode.
            if (assistantText.trim().length < 32 && phaseInfo.phase === 'iterate' && priorHtml) {
              sseWrite({ type: 'text', chunk: '\n↻ 第一次输出为空，重试中…\n' });
              // Retry without inlining the prior HTML — same observation as
              // the iterate prompt itself: claude --print silently no-ops
              // when fed multi-KB of HTML to rewrite.
              const sum = summariseHtmlForIterate(priorHtml);
              const retryPrompt = [
                'Output ONE complete ```html block — full self-contained 1920×1080 page. Nothing else.',
                '',
                `User request: ${userText.slice(0, 300)}`,
                sum.headline ? `Headline: ${sum.headline}` : '',
                sum.subheads.length
                  ? `Subheads:\n${sum.subheads
                      .slice(0, 4)
                      .map((s) => `  · ${s}`)
                      .join('\n')}`
                  : '',
                sum.bgColors.length ? `Palette: ${sum.bgColors.join(' / ')}` : '',
                sum.fontFamilies.length ? `Fonts: ${sum.fontFamilies.join(', ')}` : '',
                '',
                'Begin reply with ```html. Tag visible text with data-hv-text. No prose outside the block.',
              ]
                .filter(Boolean)
                .join('\n');
              let retryText = '';
              const retryHandle = spawnAgent({
                def: agentDef,
                prompt: retryPrompt,
                context: { cwd: projectDir },
                onEvent: (ev) => {
                  if (ev.type === 'text') {
                    retryText += ev.chunk;
                    textChunks += 1;
                    sseWrite(ev);
                  } else if (ev.type === 'error' || ev.type === 'message_end') {
                    sseWrite(ev);
                  }
                },
              });
              await retryHandle.done;
              assistantText += retryText;
              process.stderr.write(
                `[studio:msg] proj=${id} retry done text=${retryText.length}B\n`,
              );
            }

            // Single-frame iterate: result HTML goes back to the focused frame
            // only — never overwrites the whole preview.html.
            if (focusFrameId) {
              const extracted = extractHtmlDocument(assistantText);
              if (extracted) {
                try {
                  await ctx.orchestrator.writeFrameHtml(id, focusFrameId, extracted);
                  sseWrite({
                    type: 'preview_ready',
                    preview_url: `/preview/${id}`,
                    focused_frame: focusFrameId,
                  });
                  summaryLine = `✓ frame ${focusFrameId} updated`;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  sseWrite({
                    type: 'text',
                    chunk: `\n[frame ${focusFrameId} write failed: ${msg}]\n`,
                  });
                }
              }
            } else {
              // Multi-frame extraction on the off chance the agent did emit it
              // (e.g. on a free-text iterate turn the user's text triggered it).
              const multi = extractContentGraphAndFrames(assistantText);
              if (multi && multi.frames.length > 0) {
                await ctx.orchestrator.writeContentGraph(id, multi.graph);
                for (const f of multi.frames) {
                  try {
                    await ctx.orchestrator.writeFrameHtml(id, f.nodeId, f.html);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    sseWrite({ type: 'text', chunk: `\n[frame ${f.nodeId} skipped: ${msg}]\n` });
                  }
                }
                sseWrite({
                  type: 'preview_ready',
                  preview_url: `/preview/${id}`,
                  frames: multi.frames.length,
                });
                summaryLine = `✓ ${multi.frames.length}-frame storyboard generated (intent: ${multi.graph.intent})`;
              } else {
                const extracted = extractHtmlDocument(assistantText);
                if (extracted) {
                  await ctx.orchestrator.writePreviewHtmlRaw(id, extracted);
                  sseWrite({ type: 'preview_ready', preview_url: `/preview/${id}` });
                  summaryLine = '✓ updated the HTML preview';
                }
              }
            }
          }


        // Auto-advance: the content prompt instructs the agent to append
        // <!-- hv-phase:content-question --> when it still needs more info.
        // Absence of that marker means it has enough — immediately run the
        // style phase in the same SSE stream so the user sees the style card
        // without having to send an extra "ok" message.
        if (phaseInfo.phase === 'content' && !/<!--\s*hv-phase:content-question\s*-->/i.test(assistantText)) {
          const autoPickedType = lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType ?? '';
          const stylePrompt = buildStylePhasePrompt(autoPickedType);
          const styleHandle = spawnAgent({
            def: agentDef,
            prompt: stylePrompt,
            context: { cwd: projectDir, ...(agentModel && { model: agentModel }) },
            onEvent: (ev) => {
              if (ev.type === 'text') {
                assistantText += ev.chunk;
                textChunks += 1;
                sseWrite(ev);
              } else if (ev.type === 'error') {
                process.stderr.write(`[studio:msg] proj=${id} style-autoadvance error: ${ev.message}\n`);
              }
            },
          });
          await styleHandle.done;
        }

        // Persist assistant message — strip the html / graph blocks when present (UI sees summary line)
          let persistText = summaryLine
            ? assistantText
                .replace(/```html[#\w-]*[\s\S]*?```/gi, '')
                .replace(/```json#content-graph[\s\S]*?```/i, '')
                .replace(/```json[\s\S]*?```/i, (m) =>
                  /content-graph|"intent"\s*:|"nodes"\s*:/i.test(m) ? '' : m,
                )
                .trim() || summaryLine
            : assistantText;

          // Empty agent reply (no HTML, no graph, no prose) usually means the
          // prompt confused the model into doing nothing. Give the user something
          // actionable instead of a blank speech bubble.
          if (!persistText.trim()) {
            const fallback =
              '⚠️ The agent returned an empty reply. Try rephrasing your request — e.g. tell it the brand / topic / 1-2 concrete details, or which kind of frame you want first.';
            sseWrite({ type: 'text', chunk: fallback });
            persistText = fallback;
          }
          history.push({
            role: 'assistant',
            agent: agentDef.id,
            content: persistText,
            ts: Date.now(),
          });
          MESSAGES.set(id, history);
          await saveMessages(ctx, id, history);
          // discard project0 reference to keep TS happy
          void project0;
          res.end();
          return;
        } finally {
          GENERATING.delete(id);
        }
      }

      // Is a generation currently running for this project? Lets a returning
      // client show "still generating…" instead of a blank where the live
      // progress lines used to be.
      const genStatusMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/generating$/);
      if (genStatusMatch?.[1] && m === 'GET') {
        return json(res, 200, { generating: GENERATING.has(genStatusMatch[1]) });
      }

      // ============== v0.8: content-graph + frames API ==============

      // GET content graph as JSON
      const cgMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/content-graph$/);
      if (cgMatch?.[1] && m === 'GET') {
        const graph = await ctx.orchestrator.readContentGraph(cgMatch[1]);
        if (!graph) return json(res, 404, { error: 'No content graph for this project' });
        return json(res, 200, { graph });
      }

      // Re-pace each frame's duration to match the narration: split the total
      // duration across frames in proportion to each frame's narration length
      // (a frame with twice the words holds twice as long), so a generated
      // voiceover and the visuals stay in step. Min 2s per frame.
      const fitMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/fit-durations$/);
      if (fitMatch?.[1] && m === 'POST') {
        const projectId = fitMatch[1];
        const graph = await ctx.orchestrator.readContentGraph(projectId);
        if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
          return json(res, 400, { error: 'No frames yet — generate the video first.' });
        }
        const byFrame =
          ((await readBody(req)) as { narrationByFrame?: Record<string, string> })
            .narrationByFrame ?? {};
        const lenOf = (id: string) => byFrame[id]?.trim().length ?? 0;
        const totalChars = graph.nodes.reduce((s, n) => s + lenOf(n.id), 0);
        if (totalChars === 0) {
          return json(res, 400, { error: 'No narration yet — draft narration first, then fit.' });
        }
        const MIN = 2;
        // Keep total duration, but if there isn't enough to give every frame the
        // minimum at its char-share, scale the total up so MIN is always honored
        // (≈0.18s of speech per character is a comfortable narration pace).
        const SEC_PER_CHAR = 0.18;
        const currentTotal = graph.nodes.reduce((s, n) => s + (n.durationSec ?? MIN), 0);
        const neededForSpeech = Math.ceil(totalChars * SEC_PER_CHAR);
        const total = Math.max(currentTotal, neededForSpeech, MIN * graph.nodes.length);
        // Proportional by char share, then lift any frame below MIN.
        const durs = graph.nodes.map((n) => ({
          n,
          d: Math.max(MIN, Math.round((lenOf(n.id) / totalChars) * total)),
        }));
        // Re-normalize so the rounded sum matches `total` (adjust the longest frame).
        const sum = durs.reduce((s, x) => s + x.d, 0);
        if (sum !== total && durs.length) {
          const longest = durs.reduce((a, b) => (b.d > a.d ? b : a));
          longest.d = Math.max(MIN, longest.d + (total - sum));
        }
        for (const { n, d } of durs) n.durationSec = d;
        // preserveFrames: fit only re-times an EXISTING storyboard — must not
        // wipe the rendered frames (that left export with no frames → it fell
        // back to a single 5s template still instead of the multi-frame video).
        await ctx.orchestrator.writeContentGraph(projectId, graph, { preserveFrames: true });
        const durations = Object.fromEntries(graph.nodes.map((n) => [n.id, n.durationSec]));
        return json(res, 200, {
          ok: true,
          durations,
          totalSec: graph.nodes.reduce((s, n) => s + (n.durationSec ?? 0), 0),
        });
      }

      // PUT /api/projects/:id/frames/order — strip drag reorder (HTML kept).
      const orderMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/frames\/order$/);
      if (orderMatch?.[1] && m === 'PUT') {
        const body = (await readBody(req)) as { order?: unknown };
        const order = body.order;
        if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) {
          return json(res, 400, { error: 'body.order must be string[] of graph node ids' });
        }
        try {
          const { project } = await ctx.orchestrator.reorderFrames(
            orderMatch[1],
            order as string[],
          );
          return json(res, 200, { project });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return json(res, 400, { error: msg });
        }
      }

      // PATCH /api/projects/:id/frames/:nodeId — set durationSec (pacing).
      const framePatchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)$/);
      if (framePatchMatch?.[1] && framePatchMatch[2] && m === 'PATCH') {
        const body = (await readBody(req)) as { durationSec?: unknown };
        const dur = Number(body.durationSec);
        if (!Number.isFinite(dur)) {
          return json(res, 400, { error: 'body.durationSec must be a number' });
        }
        try {
          const { project, frame, durationSec } = await ctx.orchestrator.setFrameDuration(
            framePatchMatch[1],
            decodeURIComponent(framePatchMatch[2]),
            dur,
          );
          return json(res, 200, { project, frame, durationSec });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return json(res, 400, { error: msg });
        }
      }

      // ============== File serving ==============

      // Project preview HTML (and any sibling files like assets/)
      const previewServeMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (previewServeMatch?.[1]) {
        const projId = previewServeMatch[1];
        const sub = previewServeMatch[2] ?? '/preview.html';
        const project = await ctx.orchestrator.load(projId);

        // Phase C: serve an enhanced frame's preview MP4 (native Remotion frames
        // have no HTML). Match the `.mp4` suffix BEFORE the plain HTML frame route.
        const frameMp4Match = sub.match(/^\/frame\/([a-z0-9_-]+)\.mp4$/i);
        if (frameMp4Match?.[1]) {
          const frame = (project.frames ?? []).find((f) => f.graphNodeId === frameMp4Match[1]);
          if (frame?.previewMp4Path && existsSync(frame.previewMp4Path)) {
            return serveFile(frame.previewMp4Path, res);
          }
          res.writeHead(404);
          return res.end('No preview MP4 for frame');
        }

        // v0.8: serve a specific frame HTML by graph node id
        const frameMatch = sub.match(/^\/frame\/([a-z0-9_-]+)$/i);
        if (frameMatch?.[1]) {
          const nodeId = frameMatch[1];
          const frame = (project.frames ?? []).find((f) => f.graphNodeId === nodeId);
          if (frame && existsSync(frame.htmlPath)) {
            return serveFile(frame.htmlPath, res);
          }
          res.writeHead(404);
          return res.end('Frame not found');
        }

        const baseDir = project.lastPreviewHtmlPath ? dirname(project.lastPreviewHtmlPath) : null;
        if (!baseDir) {
          res.writeHead(404);
          return res.end('Preview not rendered yet');
        }
        const filePath =
          sub === '/preview.html' || sub === '/'
            ? project.lastPreviewHtmlPath!
            : join(baseDir, sub);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          return serveFile(filePath, res);
        }
        // Fallback: also try project assets/
        const projAssets = join(dirname(baseDir), 'assets', basename(sub));
        if (existsSync(projAssets)) return serveFile(projAssets, res);
        // Fallback 2 (multi-composition templates): hyperframes templates ship
        // with sibling files like compositions/intro.html that the entry
        // index.html references via data-composition-src. Project dir only
        // holds the rewritten preview.html — sibling files live in the
        // template's own dir. Resolve relative to that, but only when the
        // requested path is below the project's selected template (so a
        // project can't read a different template's files).
        if (project.templateId) {
          try {
            const tmpl = ctx.templates.get(project.templateId);
            if (tmpl?.__dir && sub.length > 1) {
              const tmplFile = join(tmpl.__dir, sub.replace(/^\//, ''));
              const tmplResolved = resolve(tmplFile);
              const tmplRoot = resolve(tmpl.__dir);
              if (
                tmplResolved.startsWith(`${tmplRoot}/`) &&
                existsSync(tmplResolved) &&
                statSync(tmplResolved).isFile()
              ) {
                return serveFile(tmplResolved, res);
              }
            }
          } catch {
            /* template lookup failed → just 404 */
          }
        }
        res.writeHead(404);
        return res.end('Not found');
      }

      // Asset direct serve (so iframe can load image_path etc)
      // /asset?path=<absolute-path>  — must be inside .html-video/projects
      if (url.pathname === '/asset' && m === 'GET') {
        const p = url.searchParams.get('path');
        if (!p) {
          res.writeHead(400);
          return res.end('missing ?path');
        }
        const safe = resolve(p);
        if (!safe.includes('/.html-video/projects/')) {
          res.writeHead(403);
          return res.end('forbidden');
        }
        if (existsSync(safe)) return serveFile(safe, res);
        res.writeHead(404);
        return res.end();
      }

      // Template poster (e.g. /template-asset/<id>/preview.png)
      const tplAssetMatch = url.pathname.match(/^\/template-asset\/([^/]+)\/(.+)$/);
      if (tplAssetMatch?.[1] && tplAssetMatch[2]) {
        const t = ctx.templates.get(tplAssetMatch[1]);
        const rel = tplAssetMatch[2];
        const filePath = join(t.__dir!, rel);
        if (!existsSync(filePath)) {
          res.writeHead(404);
          return res.end();
        }
        // Multi-composition templates ship an entry HTML that only stitches
        // sub-comps via data-composition-src; a raw iframe renders blank
        // because nothing assembles them. For the studio *preview* we inject a
        // tiny client-side player that fetches each composition, instantiates
        // its <template>, wires placeholders, and plays the GSAP timelines so
        // the gallery shows live motion. The template files on disk are never
        // touched — this rewrite happens only on the way out the wire.
        if (extname(filePath).toLowerCase() === '.html') {
          let html = await readFile(filePath, 'utf8');
          if (/data-composition-src/.test(html)) {
            html = injectCompositionPlayer(html);
            res.writeHead(200, {
              'content-type': MIME['.html']!,
              'cache-control': 'no-store, no-cache, must-revalidate',
              pragma: 'no-cache',
            });
            return res.end(html);
          }
        }
        return serveFile(filePath, res);
      }

      // ============== Static UI ==============
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = join(uiRoot, path);
      if (filePath.startsWith(uiRoot) && existsSync(filePath) && statSync(filePath).isFile()) {
        return serveFile(filePath, res);
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string }).code ?? 'unknown';
      json(res, 500, { error: msg, code });
    }
  });

  return new Promise((resolveFn) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolveFn({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Message history — in-memory cache, JSON file as source of truth.
//
// v0.8.2: previously memory-only, so chat history evaporated on every studio
// restart. Now persisted to <projectDir>/messages.json. Cache is lazy-loaded
// on first GET / POST per project; writes go through saveMessages().
// ---------------------------------------------------------------------------
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agent?: string;
  tool?: string;
  output?: unknown;
  ts: number;
}

const MESSAGES = new Map<string, ChatMessage[]>();

/** Projects with a generation running right now (detached from any request).
 *  Lets a client that switched away and came back learn the task is still alive
 *  ("⏳ still generating…") instead of seeing the progress lines vanish. */
const GENERATING = new Set<string>();

async function loadMessages(ctx: CliContext, projectId: string): Promise<ChatMessage[]> {
  const cached = MESSAGES.get(projectId);
  if (cached) return cached;
  const projectDir = await ctx.projects.ensureDir(projectId);
  const filePath = join(projectDir, 'messages.json');
  if (!existsSync(filePath)) {
    MESSAGES.set(projectId, []);
    return MESSAGES.get(projectId)!;
  }
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
    MESSAGES.set(projectId, arr);
    return arr;
  } catch {
    // Corrupt file — start fresh in memory but don't overwrite the file
    // until the next save (gives the user a chance to recover by hand).
    MESSAGES.set(projectId, []);
    return MESSAGES.get(projectId)!;
  }
}

async function saveMessages(
  ctx: CliContext,
  projectId: string,
  messages: ChatMessage[],
): Promise<void> {
  const projectDir = await ctx.projects.ensureDir(projectId);
  const filePath = join(projectDir, 'messages.json');
  const fs = await import('node:fs/promises');
  await fs.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf8');
}

/**
 * Parse the format-card `remotion_enhance` value into a native template id.
 * Accepts: '关' → null; legacy '开…' → default rollup; or a known native id.
 */
function resolveRemotionEnhanceChoice(choice: string, ctx: CliContext): string | null {
  if (!choice || choice === '关' || choice === 'off' || choice === 'Off') return null;
  const natives = ctx.templates.listNative();
  if (natives.length === 0) return null;
  if (natives.some((t) => t.id === choice)) return choice;
  // Legacy format-card value was "开" / "开 · Remotion"
  if (choice.startsWith('开') || /^on\b/i.test(choice)) {
    return natives.some((t) => t.id === 'frame-data-rollup')
      ? 'frame-data-rollup'
      : (natives[0]?.id ?? null);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Split multi-frame generate
//
// `claude --print` is unreliable when asked to emit a content-graph PLUS
// 4-6 full HTML pages in one shot — it tends to time out at 100s+ with 1
// byte of output. Each call individually is fine, so we orchestrate:
//
//   1. one short call → graph JSON
//   2. one short call per node → frame HTML
//
// Each step writes its result to disk and pushes an SSE event so the UI
// can show "frame N/M" progress.
// ---------------------------------------------------------------------------
interface SplitGenerateArgs {
  ctx: CliContext;
  projectId: string;
  projectDir: string;
  agentDef: import('@html-video/runtime').AgentDef;
  agentModel?: string | undefined;
  tmpl: import('@html-video/core').TemplateMetadata | null;
  priorHtml: string;
  inputs: PhaseInputs;
  attachments: Attachment[];
  /** The user's original opening subject, locked across phases. */
  openingTopic?: string;
  /**
   * Restyle mode: keep the EXISTING content-graph text verbatim and only
   * re-render each frame's HTML in the new style. Skips the Step-1 graph
   * re-plan. Used by the post-generation "换风格 / 改时长" sub-flows.
   */
  restyleOnly?: boolean;
  /** Called for human-readable progress lines. */
  onProgress: (msg: string) => void;
  /** Called for structured SSE events. */
  onSse: (obj: unknown) => void;
}

// NOTE: the old classifyIterateIntent (LLM guesses rewrite-all/edit-visual/
// edit-frame from one sentence) was removed. The post-generation flow no longer
// guesses: detectPhase routes a vague "改一下" to an explicit edit-menu card
// (style / content / duration) and the user's pick drives restyle /
// iterate-content / iterate-format.

async function runSplitMultiFrameGenerate(
  args: SplitGenerateArgs,
): Promise<{ frameCount: number; intent: string }> {
  const {
    ctx,
    projectId,
    projectDir,
    agentDef,
    agentModel,
    tmpl,
    priorHtml,
    inputs,
    attachments,
    openingTopic,
    restyleOnly,
    onProgress,
    onSse,
  } = args;
  const collected = inputs.collected ?? {};
  const pickedType = inputs.pickedType ?? '';
  const pickedStyle = inputs.pickedStyle ?? '';
  const contentTurns = inputs.contentTurns ?? [];
  // When a template is selected, its OWN source HTML is the style ground truth —
  // every frame must reuse its palette/typography/layout/motion. Previously
  // split-generate only passed the template's one-line description, so a picked
  // template (e.g. Swiss Grid: light grey + black/gold serif) came out as a
  // generic dark theme. Read the real source once and force it into each frame.
  let templateHtml = '';
  if (tmpl?.__dir && tmpl.source_entry) {
    try {
      const { readFileSync } = await import('node:fs');
      const p = join(tmpl.__dir, tmpl.source_entry);
      if (existsSync(p)) templateHtml = readFileSync(p, 'utf8');
    } catch {
      /* fall back to description-only */
    }
  }
  const aspect = (collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9';
  const frameCountReq = Math.max(2, Math.min(10, Number(collected.frame_count ?? '4') || 4));
  // Opt-in (format card): render data frames natively with Remotion. Value is
  // '关' / legacy '开…' / or a native template id. When on, the planner must
  // give every data node structured items, and after each data frame's HTML is
  // written we enhance it in place (best-effort).
  const remotionChoice = (collected.remotion_enhance ?? '关').trim();
  const enhanceNativeTemplateId = resolveRemotionEnhanceChoice(remotionChoice, ctx);
  const enhanceData = !!enhanceNativeTemplateId;
  // Prefer per-frame pacing (total = per_frame × frames) — set by the format
  // card so a short total ÷ many frames can't produce a rushed clip. Fall back
  // to total ÷ frames for older projects that only stored `duration`.
  const perFrameInput = Number(collected.per_frame ?? '') || 0;
  const perFrameDurationSec =
    perFrameInput > 0
      ? Math.max(2, perFrameInput)
      : Math.max(2, Math.floor((Number(collected.duration ?? '15') || 15) / frameCountReq));
  const totalDurationSec =
    perFrameInput > 0
      ? perFrameDurationSec * frameCountReq
      : Number(collected.duration ?? '15') || 15;
  let resolution = '1920×1080';
  if (aspect === '9:16') resolution = '1080×1920';
  else if (aspect === '1:1') resolution = '1080×1080';
  else if (aspect === '4:5') resolution = '1080×1350';
  // Persist the chosen resolution on the project so EXPORT records at the right
  // aspect (it reads project.preferences.resolution; without this it defaulted
  // to 1920×1080 and squashed a 4:5 / 9:16 frame into a 16:9 canvas).
  {
    const [w, h] = resolution.split('×').map(Number);
    if (w && h) {
      const proj = await ctx.projects.load(projectId);
      proj.preferences = { ...proj.preferences, resolution: { width: w, height: h } };
      await ctx.projects.save(proj);
    }
  }

  const styleLabel =
    pickedStyle && /^从设计模板选|template/i.test(pickedStyle)
      ? tmpl
        ? `(use the selected template "${tmpl.name}" — ${tmpl.description})`
        : '(let the model choose)'
      : pickedStyle;

  // ---- Step 1: obtain the content graph ----
  let graph: import('@html-video/content-graph').ContentGraph;
  if (restyleOnly) {
    // Restyle / re-time: keep the EXISTING storyboard text verbatim, skip the
    // re-plan entirely. Only Step 2 (per-frame HTML) re-runs, in the new style.
    const existing = await ctx.orchestrator.readContentGraph(projectId);
    if (!existing || !Array.isArray(existing.nodes) || existing.nodes.length === 0) {
      throw new Error('restyle requested but the project has no existing storyboard to reuse');
    }
    graph = existing as import('@html-video/content-graph').ContentGraph;
    onProgress(`✓ 沿用现有文案：${graph.nodes.length} 帧`);
    onSse({ type: 'plan_ready', frame_count: graph.nodes.length, intent: graph.intent });
  } else {
    onProgress(`📋 规划 ${frameCountReq} 帧的故事板…`);
    const graphPromptParts: string[] = [];
    graphPromptParts.push(
      `Plan a ${frameCountReq}-frame HTML video storyboard. Output ONLY a content-graph JSON in a fenced \`\`\`json#content-graph block — no HTML, no prose outside.`,
    );
    graphPromptParts.push('');
    graphPromptParts.push(
      'Inputs (use literally — do NOT invent brand names or facts beyond these):',
    );
    graphPromptParts.push(
      `- 类型 / type: ${pickedType || '(unspecified)'} (this is the FORMAT, NOT the subject — never make the video be "about" the type itself)`,
    );
    // Lock the storyboard to the user's opening subject (unless a SOURCE MATERIAL
    // block below supersedes it). This is the path the user actually hits, and
    // where "随机" turned into a randomness explainer instead of the Open Design
    // promo they asked for.
    if (openingTopic && !attachments.some((a) => !!a.inlineText)) {
      graphPromptParts.push(
        `- 主题 / subject (LOCKED): the user opened with "${openingTopic}". The synopsis and EVERY node MUST be about this subject. If the content line below is a vague word like "随机 / 随便 / anything / 你定", it means "you choose the concrete angle and points — but keep the subject = "${openingTopic}"". NEVER make the video about randomness or the literal word.`,
      );
    }
    if (contentTurns.length > 0) {
      graphPromptParts.push('- 内容 / content:');
      for (const t of contentTurns)
        graphPromptParts.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
    }
    // Inline the fetched article / repo / uploaded text — THIS is the subject of
    // the video. Without it the planner only sees the type word and invents a
    // video "about 概念解说" instead of about the user's actual source.
    const { specs: designSpecs, content: contentAtts } = partitionAttachments(attachments);
    if (designSpecs.length > 0) graphPromptParts.push('', ...renderDesignSpecBlock(designSpecs));
    const sourceTexts = contentAtts.filter((a) => !!a.inlineText);
    if (sourceTexts.length > 0) {
      graphPromptParts.push('');
      graphPromptParts.push(
        'SOURCE MATERIAL — the video MUST be about THIS content (real facts, names, numbers from it). This is the subject, not the type:',
      );
      for (const a of sourceTexts) {
        graphPromptParts.push(`--- ${a.filename} ---`);
        graphPromptParts.push((a.inlineText ?? '').slice(0, 6000));
      }
    }
    if (styleLabel) graphPromptParts.push(`- 风格 / style: ${styleLabel}`);
    graphPromptParts.push(
      `- 总时长: ${totalDurationSec}s split across ${frameCountReq} frames (~${perFrameDurationSec}s each)`,
    );
    graphPromptParts.push('');
    if (sourceTexts.length > 0) {
      graphPromptParts.push(
        `GROUNDING (REQUIRED): every node's text must come from the SOURCE MATERIAL above — quote its real product names, facts, numbers. The synopsis must name the source's actual subject. BANNED: generic filler about the content TYPE (e.g. "什么是概念解说", "信息密度×传播效率") that would fit any video. If a line could fit any topic, it's wrong.`,
      );
      graphPromptParts.push('');
    }
    graphPromptParts.push(
      `Schema (keep all keys; one node per frame; nodes[].id should be a short readable slug like "intro" / "stat_users" / "outro"):`,
    );
    graphPromptParts.push('```json#content-graph');
    graphPromptParts.push(
      JSON.stringify(
        {
          schemaVersion: 1,
          intent: 'explainer',
          synopsis: '<one-line description of the video>',
          nodes: Array.from({ length: frameCountReq }, (_, i) => {
            const kind = i === 0 ? 'text' : i === frameCountReq - 1 ? 'entity' : 'data';
            const node: Record<string, unknown> = {
              id: `frame_${i + 1}`,
              kind,
              durationSec: perFrameDurationSec,
              text: '<headline / subtitle for this frame>',
            };
            // Every data node carries structured items so it can be rendered natively
            // with Remotion (numbers roll, bars grow) — whether the user opted in now
            // or enhances the frame later from the strip. A data frame without numbers
            // is just a text frame.
            if (kind === 'data') {
              node.data = {
                title: '<short chart title>',
                unit: '<optional unit, e.g. K / % / ★>',
                items: [
                  { label: '<label>', value: 0 },
                  { label: '<label>', value: 0 },
                ],
              };
            }
            return node;
          }),
          edges: Array.from({ length: frameCountReq - 1 }, (_, i) => ({
            from: `frame_${i + 1}`,
            to: `frame_${i + 2}`,
            kind: 'sequence',
          })),
        },
        null,
        2,
      ),
    );
    graphPromptParts.push('```');
    graphPromptParts.push('');
    graphPromptParts.push(
      'Replace the placeholder text in each node with concrete content from the inputs. Adjust intent to match (single-frame|explainer|data-viz|promo|comparison|other). Keep node ids unique. Do NOT return an empty reply. Do NOT emit any HTML this turn.',
    );
    graphPromptParts.push(
      `DATA FRAMES: every \`kind:"data"\` node MUST carry a \`data\` object \`{ title?, unit?, items: [{ label, value }] }\` with at least 2 items and numeric \`value\`s drawn from the inputs/source — real figures, not placeholders (they can be animated with rolling counters / growing bars). The node's \`text\` still holds the headline. If a frame genuinely has no quantitative data, make it a \`text\` node instead of \`data\`.`,
    );
    graphPromptParts.push(
      `DATA FRAME QUALITY: (1) Items in ONE data frame must be COMPARABLE — the same unit and a similar order of magnitude. Do NOT mix wildly different scales in one chart (e.g. 61,000 GitHub stars next to 142 plugins) — one giant bar makes the rest invisible. If figures have different units or scales, split them across separate data frames, or pick the 2-4 that genuinely compare. (2) \`unit\` is OPTIONAL and only for a real shared unit (e.g. "%", "K", "★", "ms"). If the numbers are plain counts with no meaningful unit, OMIT \`unit\` entirely — never use filler like "count" / "个" / "次".`,
    );
    graphPromptParts.push(
      `STRICT JSON: the block must be valid JSON. Inside string values do NOT use straight double-quotes ("…") — if you need to quote a term or title, use 「」 or 《》 or single quotes. No trailing commas. No comments.`,
    );

    const graphPrompt = graphPromptParts.join('\n');
    const graphText = await callAgentSimple(agentDef, graphPrompt, projectDir, agentModel);
    const graphMatch =
      /```json#content-graph\s*\n([\s\S]*?)```/i.exec(graphText) ??
      /```json\s*\n([\s\S]*?)```/i.exec(graphText);
    if (!graphMatch || !graphMatch[1]) {
      throw new Error(
        `agent did not return a content-graph (got ${graphText.length} bytes, head: ${graphText.slice(0, 80)})`,
      );
    }
    try {
      graph = parseGraphJsonTolerant(graphMatch[1].trim()) as typeof graph;
    } catch (e) {
      throw new Error(`graph JSON failed to parse: ${e instanceof Error ? e.message : e}`);
    }
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      throw new Error('graph has no nodes');
    }
    await ctx.orchestrator.writeContentGraph(projectId, graph);
    onProgress(`✓ 故事板规划完成：${graph.nodes.length} 帧 (${graph.intent})`);
    onSse({ type: 'plan_ready', frame_count: graph.nodes.length, intent: graph.intent });
  }

  // ---- Step 2: one call per node, output a single ```html block ----
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i]!;
    const nodeId = node.id;
    onProgress(`🎬 生成第 ${i + 1}/${graph.nodes.length} 帧 (${nodeId})…`);
    onSse({ type: 'frame_started', node_id: nodeId, order: i, total: graph.nodes.length });

    const frameContext = describeNode(node);
    const fp: string[] = [];
    fp.push(
      `Generate ONE complete HTML page for frame "${nodeId}" of a ${graph.nodes.length}-frame video. Output ONE \`\`\`html block, nothing else.`,
    );
    fp.push('');
    fp.push(`Frame ${i + 1} of ${graph.nodes.length}: ${frameContext}`);
    if (restyleOnly) {
      // Keep the exact words; only the visual style changes.
      fp.push(
        `RESTYLE: keep this frame's TEXT EXACTLY as given above — same headline, subtitle, numbers, wording. Do NOT rewrite, translate, or reword anything. Change ONLY the visual style (layout, colour, typography, motion) to: ${styleLabel || pickedStyle || '(the new style)'}.`,
      );
    }
    if (openingTopic && !attachments.some((a) => !!a.inlineText)) {
      fp.push(
        `Subject (locked): "${openingTopic}". This frame is about this subject; "随机/随便" anywhere in the inputs means you pick details, not a new topic.`,
      );
    }
    fp.push(`Duration: ${node.durationSec ?? perFrameDurationSec}s`);
    fp.push(`Type: ${pickedType}`);
    if (styleLabel) fp.push(`Style: ${styleLabel}`);
    fp.push(`Resolution: ${aspect} (${resolution})`);
    fp.push('');
    if (contentTurns.length > 0) {
      fp.push('Source material from the user (use literally; do NOT invent facts):');
      for (const t of contentTurns) fp.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
      fp.push('');
    }
    // Fetched article/repo text — keep the per-frame HTML grounded in the real
    // source, not just the one-line graph node. (Graph step gets the full text;
    // give each frame a trimmed slice so it can pull accurate specifics.)
    const { specs: frameSpecs, content: frameContentAtts } = partitionAttachments(attachments);
    if (frameSpecs.length > 0) fp.push(...renderDesignSpecBlock(frameSpecs));
    const frameSourceTexts = frameContentAtts.filter((a) => !!a.inlineText);
    if (frameSourceTexts.length > 0) {
      fp.push(
        `SOURCE MATERIAL (the video's real subject — use its actual facts/names/numbers, never generic filler about the content type):`,
      );
      for (const a of frameSourceTexts) fp.push((a.inlineText ?? '').slice(0, 3000));
      fp.push('');
    }
    fp.push(
      `Output: begin with \`\`\`html and end with \`\`\`. Inline CSS + JS, full-bleed ${resolution}, opens with an animation timeline. Tag visible text with data-hv-text. CDN imports (Tailwind, GSAP) fine. No prose outside the block.`,
    );
    fp.push('');
    if (templateHtml) {
      // A template is selected → its HTML is the REQUIRED look for every frame.
      fp.push(
        `Template HTML — this is the REQUIRED visual style for THIS frame. Reuse its exact palette, background, typography, layout structure and animation approach; only swap in this frame's text/data. Do NOT invent a different theme (no generic dark background unless the template itself is dark):`,
      );
      fp.push('```html');
      fp.push(templateHtml.slice(0, 4000));
      fp.push('```');
      fp.push('');
      fp.push(
        `Keep all ${graph.nodes.length} frames visually consistent with this template so they read as one video.`,
      );
    } else {
      fp.push('Skeleton to extend (replace placeholder, expand styling per type / style):');
      fp.push('```html');
      fp.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
      fp.push('```');
      if (priorHtml && priorHtml.length > 0) {
        fp.push('');
        fp.push(
          'Visual style reference (mine for palette / typography / motion vocabulary, do not copy literally):',
        );
        fp.push('```html');
        fp.push(priorHtml.slice(0, 2400));
        fp.push('```');
      }
    }
    if (i === 0 && attachments.length > 0) {
      fp.push('');
      fp.push(
        'User attachments (binary = assets; inlined text = source material to base content on):',
      );
      for (const a of attachments) fp.push(...renderAttachment(a));
    }
    fp.push('');
    fp.push('Do NOT return an empty reply. Output the full HTML.');

    const framePrompt = fp.join('\n');
    let frameText = await callAgentSimple(agentDef, framePrompt, projectDir, agentModel);
    let extracted =
      /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim() ??
      /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];

    // One retry on empty: shorter prompt, just the skeleton call.
    if (!extracted) {
      onProgress(`  ↻ 第 ${i + 1} 帧首试为空，重试…`);
      const retryPrompt = `Output ONE complete HTML video frame in a fenced \`\`\`html block. Frame purpose: ${frameContext}. Style: ${styleLabel || 'tasteful default'}. Resolution: ${resolution}. ${contentTurns.length ? `Content: ${contentTurns.join(' / ').slice(0, 200)}` : ''} \n\nBegin your reply with \`\`\`html. Inline CSS, opens with animation, tag text with data-hv-text. No prose.`;
      frameText = await callAgentSimple(agentDef, retryPrompt, projectDir, agentModel);
      extracted =
        /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim() ??
        /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];
    }
    if (!extracted) {
      throw new Error(`frame "${nodeId}" generation returned empty (${frameText.length}B)`);
    }
    await ctx.orchestrator.writeFrameHtml(projectId, nodeId, extracted);
    // Native Remotion enhancement (opt-in via format card). The frame now has a
    // FrameRecord, so enhanceFrameNative can set engine/nativeTemplateId/data in
    // place. Best-effort: if the data node lacks usable {label,value} items it
    // throws — we keep the hyperframes HTML and warn rather than fail the run.
    if (enhanceData && enhanceNativeTemplateId && node.kind === 'data') {
      try {
        // Two steps, same as the manual enhance endpoint: (1) set the frame's
        // engine/data, (2) actually RENDER the preview MP4. Without step 2 the
        // frame is flagged remotion but has no previewMp4Path, so the studio
        // tries to play a <video> that 404s → black thumbnail + preview.
        await ctx.orchestrator.enhanceFrameNative(projectId, nodeId, enhanceNativeTemplateId);
        onProgress(`  ⚡ 第 ${i + 1} 帧渲染 Remotion (${enhanceNativeTemplateId})…`);
        await ctx.orchestrator.renderFrameNativePreview({ projectId, graphNodeId: nodeId });
        onSse({
          type: 'frame_enhanced',
          node_id: nodeId,
          order: i,
          native_template_id: enhanceNativeTemplateId,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(
          `[studio:split-generate] proj=${projectId} frame=${nodeId} enhance skipped: ${msg}\n`,
        );
        onProgress(`  ⚠️ 第 ${i + 1} 帧无法用 Remotion 增强（回落静态 HTML）：${msg}`);
        // Revert the engine flag so the frame falls back to its hyperframes HTML
        // (the <iframe> path) instead of showing a broken <video>.
        try {
          await ctx.orchestrator.unenhanceFrame(projectId, nodeId);
        } catch {
          /* ignore */
        }
      }
    }
    onProgress(`  ✓ 第 ${i + 1}/${graph.nodes.length} 帧完成 (${nodeId})`);
    onSse({ type: 'frame_done', node_id: nodeId, order: i, total: graph.nodes.length });
  }

  return { frameCount: graph.nodes.length, intent: graph.intent };
}

/** Describe a node's purpose for prompt context. */
function describeNode(node: import('@html-video/content-graph').Node): string {
  const bits: string[] = [];
  if (node.label) bits.push(node.label);
  if ((node as { text?: string }).text)
    bits.push(`text: ${(node as { text: string }).text.slice(0, 200)}`);
  if (node.kind === 'data' && (node as { data?: unknown }).data !== undefined) {
    bits.push(`data: ${JSON.stringify((node as { data: unknown }).data).slice(0, 200)}`);
  }
  if (node.kind === 'entity' && (node as { props?: unknown }).props !== undefined) {
    bits.push(`entity props: ${JSON.stringify((node as { props: unknown }).props).slice(0, 200)}`);
  }
  if (node.frameIntent) bits.push(`intent: ${node.frameIntent}`);
  if (bits.length === 0) bits.push(`(${node.kind} frame "${node.id}")`);
  return bits.join('; ');
}

/** Spawn the agent, collect all stdout text, return when done. */
async function callAgentSimple(
  def: import('@html-video/runtime').AgentDef,
  prompt: string,
  cwd: string,
  model?: string,
): Promise<string> {
  let buf = '';
  const handle = spawnAgent({
    def,
    prompt,
    context: { cwd, ...(model && { model }) },
    onEvent: (ev) => {
      if (ev.type === 'text') buf += ev.chunk;
    },
  });
  await handle.done;
  return buf;
}
