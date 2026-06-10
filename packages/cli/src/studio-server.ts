/**
 * HTTP server for the project studio (RFC-05 §UI).
 * Serves @html-video/project-studio static UI + project / template REST APIs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { CliContext } from './context.js';
import { AssetStore, generateTts, generateMusic } from '@html-video/core';
import { extractUrls, fetchSource } from './fetch-source.js';
import { detectAll, findAgent, spawnAgent } from '@html-video/runtime';

interface StudioHandle {
  url: string;
  port: number;
  close: () => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

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
      if (projMatch && projMatch[1]) {
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
            return {
              id: t.id,
              name: t.name,
              description: t.description,
              engine: t.engine,
              source_entry: t.source_entry,
              category: t.category,
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
            };
          }),
        });
      }

      // Add asset (multipart-style via JSON for v0.1: paths or inline content)
      const addAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets$/);
      if (addAssetMatch && addAssetMatch[1] && m === 'POST') {
        const id = addAssetMatch[1];
        const ct = req.headers['content-type'] ?? '';
        let project;
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
      if (rmAssetMatch && rmAssetMatch[1] && rmAssetMatch[2] && m === 'DELETE') {
        const project = await ctx.orchestrator.removeAsset(rmAssetMatch[1], rmAssetMatch[2]);
        return json(res, 200, { project });
      }

      // Set template
      const tplMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/template$/);
      if (tplMatch && tplMatch[1] && m === 'PUT') {
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
      if (agentMatch && agentMatch[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setAgent(
          agentMatch[1],
          (body.agent_id as string) || null,
          body.agent_model === undefined ? undefined : ((body.agent_model as string) || null),
        );
        return json(res, 200, { project });
      }

      // Set variables (whole bag)
      const varsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/variables$/);
      if (varsMatch && varsMatch[1] && m === 'PUT') {
        const body = await readBody(req);
        const project = await ctx.orchestrator.setVariables(
          varsMatch[1],
          (body.variables as Record<string, unknown>) ?? {},
        );
        return json(res, 200, { project });
      }

      // Render preview HTML (legacy; v0.3+ uses chat-driven path)
      const prevMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/preview$/);
      if (prevMatch && prevMatch[1] && m === 'POST') {
        const { project, htmlPath } = await ctx.orchestrator.renderPreviewHtml(prevMatch[1]);
        return json(res, 200, {
          project,
          preview_url: `/preview/${project.id}`,
          html_path: htmlPath,
        });
      }

      // Get raw preview HTML (frontend reads to parse data-hv-text nodes)
      const rawGetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/raw-html$/);
      if (rawGetMatch && rawGetMatch[1] && m === 'GET') {
        const project = await ctx.orchestrator.load(rawGetMatch[1]);
        if (!project.lastPreviewHtmlPath || !existsSync(project.lastPreviewHtmlPath)) {
          return json(res, 404, { error: 'No preview HTML yet — pick a template or send a chat first' });
        }
        const html = await readFile(project.lastPreviewHtmlPath, 'utf8');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(html);
        return;
      }

      // Write raw preview HTML (frontend posts back the modified HTML
      // after the user edits a data-hv-text field in the middle column)
      if (rawGetMatch && rawGetMatch[1] && m === 'PUT') {
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
      const frameRawMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/raw-html$/);
      if (frameRawMatch && frameRawMatch[1] && frameRawMatch[2]) {
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
      if (enhMatch && enhMatch[1] && enhMatch[2] && m === 'POST') {
        const projectId = enhMatch[1];
        const nodeId = enhMatch[2];
        const body = await readBody(req).catch(() => ({} as Record<string, unknown>));
        const nativeTemplateId = (body.nativeTemplateId as string) || 'frame-data-rollup';
        const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
        if (!wantsStream) {
          try {
            await ctx.orchestrator.enhanceFrameNative(projectId, nodeId, nativeTemplateId);
            const { project } = await ctx.orchestrator.renderFrameNativePreview({ projectId, graphNodeId: nodeId });
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
          try { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); }
          catch { /* client gone — work keeps running, result is persisted */ }
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
          process.stderr.write(`[studio:enhance] proj=${projectId} frame=${nodeId} done in ${ms}ms\n`);
          sse({ type: 'enhance_done', project, node_id: nodeId, elapsed_ms: ms });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[studio:enhance] proj=${projectId} frame=${nodeId} failed: ${msg}\n`);
          sse({ type: 'enhance_failed', message: msg });
        }
        res.end();
        return;
      }

      // Revert a frame's native enhancement back to its base hyperframes HTML.
      // Instant (no render) — the original HTML at frame.htmlPath is untouched.
      const unenhMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/unenhance$/);
      if (unenhMatch && unenhMatch[1] && unenhMatch[2] && m === 'POST') {
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
      if (expMatch && expMatch[1] && m === 'POST') {
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
          try { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); }
          catch { /* client gone — generation keeps running, result is persisted */ }
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
      if (genAudioMatch && genAudioMatch[1] && m === 'POST') {
        const projectId = genAudioMatch[1];
        const body = (await readBody(req)) as {
          music?: { prompt?: string; instrumental?: boolean; volumeDb?: number };
          narration?: { text?: string; voiceId?: string; volumeDb?: number; languageBoost?: string; byFrame?: Record<string, string> };
          fadeInSec?: number;
          fadeOutSec?: number;
        };
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const sse = (obj: unknown) => {
          try { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); }
          catch { /* client gone — generation keeps running, result is persisted */ }
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
            sse({ type: 'audio_failed', message: 'Nothing to generate — provide a music prompt and/or narration text.' });
            res.end();
            return;
          }

          if (wantMusic) {
            sse({ type: 'audio_progress', stage: 'music', message: 'generating background music…' });
            const music = await generateMusic({
              prompt: body.music!.prompt!.trim(),
              instrumental: body.music!.instrumental ?? true,
              creds,
            });
            const { asset } = await ctx.orchestrator.addBufferAsset(
              projectId,
              music.bytes,
              music.ext,
              `background music · ${body.music!.prompt!.trim().slice(0, 60)}`,
            );
            soundtrack.musicAssetId = asset.id;
            soundtrack.musicPrompt = body.music!.prompt!.trim();
            if (body.music!.volumeDb !== undefined) soundtrack.musicVolumeDb = body.music!.volumeDb;
            sse({ type: 'audio_progress', stage: 'music', message: music.providerNote, asset_id: asset.id });
          }

          if (wantNarration) {
            sse({ type: 'audio_progress', stage: 'narration', message: 'generating narration…' });
            const nar = await generateTts({
              text: body.narration!.text!.trim(),
              ...(body.narration!.voiceId !== undefined && { voiceId: body.narration!.voiceId }),
              ...(body.narration!.languageBoost !== undefined && { languageBoost: body.narration!.languageBoost }),
              creds,
            });
            const { asset } = await ctx.orchestrator.addBufferAsset(
              projectId,
              nar.bytes,
              nar.ext,
              `narration · ${body.narration!.text!.trim().slice(0, 60)}`,
            );
            soundtrack.narrationAssetId = asset.id;
            soundtrack.narrationText = body.narration!.text!.trim();
            if (body.narration!.byFrame) soundtrack.narrationByFrame = body.narration!.byFrame;
            if (body.narration!.volumeDb !== undefined) soundtrack.narrationVolumeDb = body.narration!.volumeDb;
            sse({ type: 'audio_progress', stage: 'narration', message: nar.providerNote, asset_id: asset.id });
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
      if (draftNarrMatch && draftNarrMatch[1] && m === 'POST') {
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
          const nodeText = (n: typeof graph.nodes[number]): string =>
            (n.kind === 'text' ? n.text : undefined) ?? n.label ?? n.id;
          const allFrames = graph.nodes.map((n, i) => ({ id: n.id, idx: i, text: nodeText(n).replace(/\n/g, ' ').slice(0, 240) }));
          const frameLines = allFrames.map((f) => `${f.idx + 1}. ${f.text}`).join('\n');

          const narrationByFrame: Record<string, string> = {};

          if (body.frameId) {
            // ---- single frame: narrate just this one, with the rest as context ----
            const target = allFrames.find((f) => f.id === body.frameId);
            if (!target) return json(res, 400, { error: `frame "${body.frameId}" not in content-graph` });
            const prompt = [
              `This is a ${allFrames.length}-frame video. Write the spoken NARRATION for FRAME ${target.idx + 1} ONLY.`,
              ``,
              `All frames (for context):`,
              frameLines,
              ``,
              graph.synopsis ? `Synopsis: ${graph.synopsis}` : '',
              ``,
              `Write ONE short spoken sentence narrating frame ${target.idx + 1} ("${target.text}") specifically — distinct, not generic.`,
              `Same language as the frame text. Plain text only: just the sentence, no numbering, quotes, or markdown.`,
            ].filter((l) => l !== undefined).join('\n');
            const raw = (await callAgentSimple(agentDef, prompt, projectDir)).trim();
            const line = raw.split('\n').map((l) => l.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim()).find((l) => l.length > 0) ?? raw;
            narrationByFrame[target.id] = line;
          } else {
            // ---- global: one line per frame, in order ----
            const prompt = [
              `Write a spoken NARRATION script for this ${allFrames.length}-frame video — ONE line per frame, IN FRAME ORDER.`,
              ``,
              `Frames (in order):`,
              frameLines,
              ``,
              graph.synopsis ? `Synopsis: ${graph.synopsis}` : '',
              ``,
              `Rules:`,
              `- Output EXACTLY ${allFrames.length} lines, one per frame, in the SAME order. Line 1 narrates frame 1, etc.`,
              `- Each line is ONE short spoken sentence about THAT specific frame's content — distinct per frame, not a generic restatement.`,
              `- The lines should still flow as a continuous voiceover read top to bottom.`,
              `- Same language as the frame text. Plain text only: one sentence per line, no numbering, bullets, blank lines, or markdown.`,
            ].filter((l) => l !== undefined).join('\n');
            const raw = (await callAgentSimple(agentDef, prompt, projectDir)).trim();
            const lines = raw.split('\n').map((l) => l.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim()).filter((l) => l.length > 0);
            // Map lines onto frames positionally; if the model under/over-produced,
            // pair as far as they line up and leave the rest blank.
            allFrames.forEach((f, i) => { if (lines[i]) narrationByFrame[f.id] = lines[i]!; });
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
      if (clearAudioMatch && clearAudioMatch[1] && m === 'DELETE') {
        const project = await ctx.orchestrator.load(clearAudioMatch[1]);
        delete project.soundtrack;
        await ctx.projects.save(project);
        return json(res, 200, { project });
      }

      // Reveal an exported file in the OS file browser. macOS: `open -R`
      // opens Finder with the file selected. Other platforms fall through
      // to a plain `open` which the OS handles best-effort.
      const revealMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reveal$/);
      if (revealMatch && revealMatch[1] && m === 'POST') {
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
      if (modelsMatch && modelsMatch[1] && m === 'GET') {
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
          return json(res, 200, { models: [], error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Agent login — currently AMR/vela only. Spawns `vela login`, which opens
      // the browser for OAuth; we wait for the process to exit (auth complete or
      // cancelled). The user signs in with their OWN Open Design account.
      const loginMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/login$/);
      if (loginMatch && loginMatch[1] && m === 'POST') {
        const agentId = loginMatch[1];
        if (agentId !== 'amr') return json(res, 400, { error: `agent "${agentId}" has no login flow` });
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
            const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* */ } rejectCode(new Error('login timed out (5 min)')); }, 5 * 60_000);
            child.on('error', (e: Error) => { clearTimeout(timer); rejectCode(e); });
            child.on('exit', (c: number | null) => { clearTimeout(timer); resolveCode(c ?? -1); });
          });
          if (code !== 0) return json(res, 400, { ok: false, error: `vela login exited with code ${code}` });
          // Re-detect (force) so the agent flips to available immediately.
          const agents = await detectAll({ force: true });
          const amr = agents.find((a) => a.id === 'amr');
          return json(res, 200, { ok: !!amr?.available, available: !!amr?.available, ...(amr?.hint && { hint: amr.hint }) });
        } catch (err) {
          return json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Agent smoke test — fires a tiny prompt at the requested agent and
      // reports timing + bytes. Used by the Settings modal so the user can
      // confirm a CLI is actually responding (not just on PATH).
      const testMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/test$/);
      if (testMatch && testMatch[1] && m === 'POST') {
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
      if (msgsMatch && msgsMatch[1] && m === 'GET') {
        const arr = await loadMessages(ctx, msgsMatch[1]);
        return json(res, 200, { messages: arr });
      }

      // Messages: POST = send + stream agent reply via SSE
      // v0.5: accepts multipart (text + files) OR JSON. Files become real
      // project assets via AssetStore; their paths are passed to the agent
      // prompt as attachments.
      if (msgsMatch && msgsMatch[1] && m === 'POST') {
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
                  } catch { /* fall back to path-only */ }
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
              try { host = new URL(sourceUrl).hostname; } catch { /* keep raw */ }
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
        const attachmentSummary = attachments.length > 0
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
        const focusFrameHtml = focusFrame && existsSync(focusFrame.htmlPath)
          ? await readFile(focusFrame.htmlPath, 'utf8')
          : '';
        const priorHtmlPath = join(projectDir, 'preview.html');
        const priorHtml = focusFrameHtml
          || (existsSync(priorHtmlPath) ? await readFile(priorHtmlPath, 'utf8') : '');
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
          if ((asset.type === 'text' || asset.type === 'data') && asset.path && !seenPaths.has(asset.path)) {
            let inlineText: string | undefined;
            try {
              const txt = await readFile(asset.path, 'utf8');
              if (txt.length <= 20_000) inlineText = txt;
            } catch { /* path-only fallback */ }
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
        } catch {/* non-fatal */}
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
          try { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); }
          catch { /* client disconnected — keep generating, result is persisted below */ }
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
          const turns = [...collectContentTurns(history), userText].filter((s) => !isControlPhrase(s));
          rewriteInputs = {
            ...phaseInfo.inputs,
            pickedType: lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType,
            pickedStyle: lastCardPickByPhase(history, 'style') ?? phaseInfo.inputs.pickedStyle ?? '',
            contentTurns: turns,
          };
        } else if (phaseInfo.phase === 'iterate-format' && isMultiFrameProject) {
          // New per-frame timing was submitted; keep content + style, re-render.
          restyleOnly = true; // reuse the existing graph text; only timing/visual recompute
          rewriteInputs = {
            ...phaseInfo.inputs,
            pickedType: lastCardPickByPhase(history, 'type') ?? phaseInfo.inputs.pickedType,
            pickedStyle: lastCardPickByPhase(history, 'style') ?? phaseInfo.inputs.pickedStyle ?? '',
            contentTurns: collectContentTurns(history),
          };
        }

        if (isMultiGenerate || rewriteInputs) {
          if (rewriteInputs) {
            const n = (project.frames ?? []).length || Number(phaseInfo.inputs.collected?.frame_count ?? '3');
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
                assistantText += msg + '\n';
                textChunks += 1;
                sseWrite({ type: 'text', chunk: msg + '\n' });
              },
              onSse: sseWrite,
            });
            summaryLine = rewriteInputs
              ? `✓ ${result.frameCount}-frame storyboard ${restyleOnly ? 'restyled' : 'regenerated'} (intent: ${result.intent})`
              : `✓ ${result.frameCount}-frame storyboard generated (intent: ${result.intent})`;
            sseWrite({ type: 'preview_ready', preview_url: `/preview/${id}`, frames: result.frameCount });
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
              `Output ONE complete \`\`\`html block — full self-contained 1920×1080 page. Nothing else.`,
              ``,
              `User request: ${userText.slice(0, 300)}`,
              sum.headline ? `Headline: ${sum.headline}` : '',
              sum.subheads.length ? `Subheads:\n${sum.subheads.slice(0, 4).map((s) => `  · ${s}`).join('\n')}` : '',
              sum.bgColors.length ? `Palette: ${sum.bgColors.join(' / ')}` : '',
              sum.fontFamilies.length ? `Fonts: ${sum.fontFamilies.join(', ')}` : '',
              ``,
              `Begin reply with \`\`\`html. Tag visible text with data-hv-text. No prose outside the block.`,
            ].filter(Boolean).join('\n');
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
                sseWrite({ type: 'preview_ready', preview_url: `/preview/${id}`, focused_frame: focusFrameId });
                summaryLine = `✓ frame ${focusFrameId} updated`;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                sseWrite({ type: 'text', chunk: `\n[frame ${focusFrameId} write failed: ${msg}]\n` });
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
              sseWrite({ type: 'preview_ready', preview_url: `/preview/${id}`, frames: multi.frames.length });
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
          const fallback = '⚠️ The agent returned an empty reply. Try rephrasing your request — e.g. tell it the brand / topic / 1-2 concrete details, or which kind of frame you want first.';
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
      if (genStatusMatch && genStatusMatch[1] && m === 'GET') {
        return json(res, 200, { generating: GENERATING.has(genStatusMatch[1]) });
      }

      // ============== v0.8: content-graph + frames API ==============

      // GET content graph as JSON
      const cgMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/content-graph$/);
      if (cgMatch && cgMatch[1] && m === 'GET') {
        const graph = await ctx.orchestrator.readContentGraph(cgMatch[1]);
        if (!graph) return json(res, 404, { error: 'No content graph for this project' });
        return json(res, 200, { graph });
      }

      // Re-pace each frame's duration to match the narration: split the total
      // duration across frames in proportion to each frame's narration length
      // (a frame with twice the words holds twice as long), so a generated
      // voiceover and the visuals stay in step. Min 2s per frame.
      const fitMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/fit-durations$/);
      if (fitMatch && fitMatch[1] && m === 'POST') {
        const projectId = fitMatch[1];
        const graph = await ctx.orchestrator.readContentGraph(projectId);
        if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
          return json(res, 400, { error: 'No frames yet — generate the video first.' });
        }
        const byFrame = ((await readBody(req)) as { narrationByFrame?: Record<string, string> }).narrationByFrame ?? {};
        const lenOf = (id: string) => (byFrame[id]?.trim().length ?? 0);
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
        let durs = graph.nodes.map((n) => ({ n, d: Math.max(MIN, Math.round((lenOf(n.id) / totalChars) * total)) }));
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
        return json(res, 200, { ok: true, durations, totalSec: graph.nodes.reduce((s, n) => s + (n.durationSec ?? 0), 0) });
      }

      // ============== File serving ==============

      // Project preview HTML (and any sibling files like assets/)
      const previewServeMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (previewServeMatch && previewServeMatch[1]) {
        const projId = previewServeMatch[1];
        const sub = previewServeMatch[2] ?? '/preview.html';
        const project = await ctx.orchestrator.load(projId);

        // Phase C: serve an enhanced frame's preview MP4 (native Remotion frames
        // have no HTML). Match the `.mp4` suffix BEFORE the plain HTML frame route.
        const frameMp4Match = sub.match(/^\/frame\/([a-z0-9_-]+)\.mp4$/i);
        if (frameMp4Match && frameMp4Match[1]) {
          const frame = (project.frames ?? []).find((f) => f.graphNodeId === frameMp4Match[1]);
          if (frame?.previewMp4Path && existsSync(frame.previewMp4Path)) {
            return serveFile(frame.previewMp4Path, res);
          }
          res.writeHead(404);
          return res.end('No preview MP4 for frame');
        }

        // v0.8: serve a specific frame HTML by graph node id
        const frameMatch = sub.match(/^\/frame\/([a-z0-9_-]+)$/i);
        if (frameMatch && frameMatch[1]) {
          const nodeId = frameMatch[1];
          const frame = (project.frames ?? []).find((f) => f.graphNodeId === nodeId);
          if (frame && existsSync(frame.htmlPath)) {
            return serveFile(frame.htmlPath, res);
          }
          res.writeHead(404);
          return res.end('Frame not found');
        }

        const baseDir = project.lastPreviewHtmlPath
          ? dirname(project.lastPreviewHtmlPath)
          : null;
        if (!baseDir) {
          res.writeHead(404);
          return res.end('Preview not rendered yet');
        }
        const filePath = sub === '/preview.html' || sub === '/'
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
                tmplResolved.startsWith(tmplRoot + '/') &&
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
      if (tplAssetMatch && tplAssetMatch[1] && tplAssetMatch[2]) {
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
// helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': MIME['.json']! });
  res.end(JSON.stringify(body));
}

/**
 * Decide how the gallery should preview a template. Both self-contained
 * entries and multi-composition entries now render live in an iframe: the
 * latter get an injected composition player (see injectCompositionPlayer) that
 * assembles the sub-comps and plays their timelines, so 'iframe' is the right
 * mode for everything that has a readable entry.
 *
 * `posterUrl` is still surfaced (when the poster file exists) so the frontend
 * can fall back to a static poster if the live iframe ever fails to render.
 */
function templatePreviewMode(
  t: import('@html-video/core').TemplateMetadata,
): { mode: 'iframe' | 'poster'; posterUrl: string | null } {
  const posterRel = t.preview?.poster;
  const posterPath = posterRel && t.__dir ? join(t.__dir, posterRel) : null;
  const posterUrl =
    posterPath && existsSync(posterPath)
      ? `/template-asset/${t.id}/${posterRel}`
      : null;
  return { mode: 'iframe', posterUrl };
}

/**
 * Inject a minimal client-side composition player into a multi-comp entry
 * HTML so the studio preview shows live motion instead of a blank iframe.
 *
 * Hyperframes templates declare their scenes as `<div data-composition-src=
 * "compositions/x.html">` placeholders; each composition file is a `<template>`
 * wrapping markup + <style> + a <script> that registers a paused GSAP timeline
 * on `window.__timelines[name]`. The real (v0.9) renderer assembles these for
 * frame-accurate export; this player is a lightweight stand-in that just makes
 * the preview move:
 *   1. swap the two known placeholders so nothing 404s / NaNs,
 *   2. fetch each composition (relative to /template-asset/<id>/), graft its
 *      <template>.content into the placeholder div, and re-run its scripts
 *      (cloned <script> nodes never execute on their own),
 *   3. once every timeline has registered, play them all on a loop.
 * Templates on disk are untouched — this is a serve-time transform only.
 */
function injectCompositionPlayer(html: string): string {
  // 15s is a sane default duration for the preview loop; __VIDEO_SRC__ has no
  // real asset in-repo, so point it at an empty data URI to avoid a 404 fetch.
  let out = html
    .replace(/__VIDEO_DURATION__/g, '15')
    .replace(/__VIDEO_SRC__/g, 'data:video/mp4;base64,');

  // The entry's own inline scripts assign window.__timelines["background"]
  // etc. before the entry ever initialises the registry — in the real HF
  // runtime the player defines it first. Mirror that: seed the registry in
  // <head> so those early assignments don't throw on an undefined object.
  const seed = '<script>window.__timelines = window.__timelines || {};</script>';
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + '\n' + seed);
  } else {
    out = seed + '\n' + out;
  }

  const player = `
<script>
(function () {
  function reexec(root) {
    // Cloned/innerHTML'd <script> nodes don't run — recreate them so each
    // composition's timeline-registration IIFE actually executes. Skip the
    // external gsap CDN tag: the entry already loaded gsap synchronously, and
    // re-adding it would race (async load) ahead of the inline IIFE that calls
    // gsap.timeline() right after it.
    root.querySelectorAll('script').forEach(function (old) {
      if (old.src) { old.parentNode.removeChild(old); return; }
      var s = document.createElement('script');
      // Each composition's inline script declares top-level \`const tl = ...\`.
      // Re-injecting several into the shared global scope collides ("tl has
      // already been declared"). Wrap each in its own block so those locals
      // stay private; window.__timelines assignments still escape the block.
      s.textContent = '{\\n' + old.textContent + '\\n}';
      old.parentNode.replaceChild(s, old);
    });
  }
  async function mountOne(host) {
    var src = host.getAttribute('data-composition-src');
    if (!src) return;
    try {
      var res = await fetch(src);
      if (!res.ok) return;
      var text = await res.text();
      var holder = document.createElement('div');
      holder.innerHTML = text;
      var tpl = holder.querySelector('template');
      var frag = tpl ? tpl.content.cloneNode(true) : holder;
      host.appendChild(frag);
      reexec(host);
    } catch (e) { /* a missing comp shouldn't blank the whole preview */ }
  }
  async function boot() {
    window.__timelines = window.__timelines || {};
    var hosts = Array.prototype.slice.call(
      document.querySelectorAll('[data-composition-src]'));
    await Promise.all(hosts.map(mountOne));
    // Give the just-injected <script> tags a tick to register timelines.
    setTimeout(function () {
      var tls = window.__timelines || {};
      Object.keys(tls).forEach(function (k) {
        var tl = tls[k];
        if (tl && typeof tl.play === 'function') {
          try { tl.repeat(-1); } catch (e) {}
          tl.play(0);
        }
      });
    }, 120);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
</script>`;

  if (out.includes('</body>')) return out.replace('</body>', player + '\n</body>');
  return out + player;
}

async function serveFile(filePath: string, res: ServerResponse): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Studio is a local dev tool — always serve fresh so v0.x updates show
    // up immediately on page load instead of being held in disk cache.
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
  });
  res.end(buf);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveFn, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolveFn(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function readBodyText(req: IncomingMessage): Promise<string> {
  return new Promise((resolveFn, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolveFn(data));
    req.on('error', reject);
  });
}

/**
 * Minimal multipart parser — returns ALL parts (fields + files).
 * Files are written to a tmp path and the path is returned.
 * For production switch to formidable / busboy.
 */
type MultipartPart =
  | { kind: 'field'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; tmpPath: string };

/**
 * Recover the real filename from a multipart part header (issue #9).
 *
 * Two encodings can appear:
 *  - `filename*=UTF-8''%E4%B8%AD%E6%96%87.md` (RFC 5987, percent-encoded) —
 *    decode the percent-escapes after stripping the charset prefix.
 *  - `filename="中文.md"` — the bytes are UTF-8, but the multipart body was
 *    read as a latin1 string, so each UTF-8 byte became one latin1 char. Round
 *    -trip latin1→utf8 to restore the original. If the name was plain ASCII the
 *    round-trip is a no-op.
 */
export function decodeUploadFilename(star: string | undefined, plain: string | undefined): string {
  if (star) {
    // RFC 5987 ext-value: charset "'" [language] "'" value  (e.g.
    // UTF-8''%E4%B8%AD.md  or  UTF-8'zh-CN'%E6%95%B0%E6%8D%AE.json).
    const m = /^[\w-]*'[^']*'(.*)$/.exec(star.trim());
    const enc = m?.[1] ?? star.trim();
    try { return decodeURIComponent(enc); } catch { return enc; }
  }
  if (plain !== undefined) {
    try { return Buffer.from(plain, 'latin1').toString('utf8'); } catch { return plain; }
  }
  return 'upload';
}

async function receiveMultipart(
  req: IncomingMessage,
  contentType: string,
): Promise<MultipartPart[]> {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) throw new Error('No multipart boundary');
  const boundary = `--${boundaryMatch[1]}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);
  const text = buf.toString('binary');
  const parts = text.split(boundary).slice(1, -1);
  const out: MultipartPart[] = [];
  const fs = await import('node:fs/promises');
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const bodyRaw = part.slice(headerEnd + 4, part.length - 2);
    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch || !nameMatch[1]) continue;
    const name = nameMatch[1];
    // RFC 5987 `filename*=UTF-8''...` (percent-encoded) wins when present;
    // otherwise fall back to the plain `filename="..."`. The plain form carries
    // raw UTF-8 BYTES, but the part was sliced out of a latin1 string above, so
    // a CJK filename arrives mojibake'd — re-decode latin1→utf8 to restore it
    // (issue #9). decodeUploadFilename handles both.
    const fnStarMatch = headers.match(/filename\*=([^;\r\n]+)/i);
    const fnMatch = headers.match(/filename="([^"]*)"/);
    if (fnStarMatch || fnMatch) {
      const filename = decodeUploadFilename(fnStarMatch?.[1], fnMatch?.[1]);
      // Keep the tmp path ASCII-safe; the real (possibly CJK) name rides on the
      // returned part, not the on-disk temp file.
      const ext = (filename.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]) ?? '';
      const tmpPath = join(tmpdir(), `hv-upload-${randomUUID().slice(0, 8)}${ext}`);
      await mkdir(dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, Buffer.from(bodyRaw, 'binary'));
      out.push({ kind: 'file', name, filename, tmpPath });
    } else {
      // Field — body is utf8 text
      out.push({ kind: 'field', name, value: Buffer.from(bodyRaw, 'binary').toString('utf8') });
    }
  }
  return out;
}

// Backward-compat shim used by the older /api/projects/:id/assets endpoint
async function receiveMultipartFile(
  req: IncomingMessage,
  contentType: string,
): Promise<{ filePath: string; filename: string }> {
  const parts = await receiveMultipart(req, contentType);
  const file = parts.find((p): p is Extract<MultipartPart, { kind: 'file' }> => p.kind === 'file');
  if (!file) throw new Error('No file field in multipart body');
  return { filePath: file.tmpPath, filename: file.filename };
}

// Keep TS aware that copyFile / AssetStore are used somewhere (they're indirectly via orchestrator)
void copyFile;
void AssetStore;

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

// `Attachment` is declared above (at the buildHtmlGenerationPrompt section)

interface BuildPromptArgs {
  tmpl: import('@html-video/core').TemplateMetadata | null;
  exampleHtml: string;
  priorHtml: string;
  history: ChatMessage[];
  userText: string;
  attachments: Attachment[];
  /** When set, iterate-phase prompts target only this frame's HTML. */
  focusFrameId?: string;
  /** The user's original opening subject, locked across phases. */
  openingTopic?: string;
}

interface Attachment {
  /** absolute path on disk */
  path: string;
  /** type the AssetStore detected */
  kind: 'image' | 'video' | 'audio' | 'data' | 'text' | 'reference-link';
  /** display name */
  filename: string;
  /** byte size */
  size: number;
  /**
   * For text sources (fetched articles/repos, uploaded .md/.txt), the actual
   * content — inlined directly into the prompt. A bare path is useless to HTTP
   * agents (Messages API runs in the cloud, can't read local disk), and even
   * for CLI agents the content should be the source material, not a file ref.
   */
  inlineText?: string;
}

/**
 * v0.5 chat prompt — guidance-first, not write-HTML-immediately.
 *
 * The system prompt tells the agent to:
 *   - On a vague first turn, ask 1–3 sharp questions instead of writing HTML
 *   - When the request + context are concrete enough, generate the full HTML
 *   - Use attachments as references / actual assets
 *   - Never use a fixed 4-question script — judge per turn what's missing
 *
 * Whether the agent writes HTML this turn is up to the agent. The server
 * extracts a fenced ```html block if present; if not, it's just a chat reply.
 */
/**
 * Conversation phases — fully sequential. Each card the assistant emits has
 * a `meta.phase` JSON field so the server can route the user's reply without
 * guessing.
 *
 *   opener  → hv-options{meta.phase:"type"}  → user picks content type
 *   content → free chat: agent asks about topic / headline / data, user
 *             can answer in 1+ turns or say "skip" / "随便"
 *   style   → hv-options{meta.phase:"style"} → user picks style preset
 *             (skipped automatically if a project template is already set)
 *   format  → hv-form{meta.phase:"format"}   → 3 segmented controls
 *             (aspect, duration, frame_count)
 *   confirm → hv-confirm{meta.phase:"confirm"} →  ✓ generate / ✏️ edit
 *   generate → emits HTML / content-graph + frames
 *
 *   info-edit → user clicked edit on confirm; re-emit format hv-form
 *   iterate   → after successful generate, free-form revision pass
 */
type ConvPhase =
  | 'opener'
  | 'content'
  | 'style'
  | 'need-template'
  | 'format'
  | 'format-edit'
  | 'confirm'
  | 'generate'
  | 'iterate'
  // Post-generation iteration sub-flow:
  | 'edit-menu'        // ask what to change (style / content / duration)
  | 'restyle'          // re-render every frame in a new style, text unchanged
  | 'iterate-content'  // re-plan the storyboard around new content
  | 'iterate-format';  // re-time / re-render with a new per-frame length

/** Did the user pick the "choose from design templates" style option? */
function isFromTemplateStyle(style: string): boolean {
  return /^从设计模板选|design template|pick.*template|from template/i.test(style.trim());
}

interface PhaseInputs {
  collected?: Record<string, string>; // last submitted hv-form values (format only)
  pickedType?: string;
  pickedStyle?: string;
  contentTurns?: string[];            // free-text user messages between type-pick and style/format
}

/** A phase reached during post-generation iteration carries postGen=true so the
 * prompt builder re-uses a card but bases the final regeneration on the existing
 * storyboard rather than starting fresh. */
type PhaseResult = { phase: ConvPhase; inputs: PhaseInputs; postGen?: boolean };

function detectPhase(
  history: ChatMessage[],
  userText: string,
  hasTemplate: boolean,
  hasSourceMaterial = false,
  focusFrameId = '',
): PhaseResult {
  const trimmed = userText.trim();
  const inputs: PhaseInputs = {};

  // Explicit markers always win.
  if (trimmed.startsWith('[hv-form:submit]')) {
    const body = trimmed.slice('[hv-form:submit]'.length).trim();
    try { inputs.collected = JSON.parse(body); } catch { /* ignore */ }
    return { phase: 'confirm', inputs };
  }
  if (trimmed === '[hv-confirm:generate]') {
    inputs.collected = lastFormSubmission(history);
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.pickedStyle = lastCardPickByPhase(history, 'style') ?? '';
    inputs.contentTurns = collectContentTurns(history);
    return { phase: 'generate', inputs };
  }
  if (trimmed === '[hv-confirm:edit]') {
    inputs.collected = lastFormSubmission(history);
    return { phase: 'format-edit', inputs };
  }

  // Free-text format reply rescue (issue #2): if the previous assistant turn
  // was asking for format params (whether it rendered the hv-form card or — as
  // the model sometimes does — just asked in prose), and this user turn parses
  // as a format answer, treat it like a card submit and advance to confirm.
  // This stops the loop where a typed "16:9 横屏 / 5s / 10" goes unrecognised
  // and the flow re-asks the same params in a different shape.
  if (!hadGenerationYet(history) && lastAssistantAskedFormat(history)) {
    const parsed = parseFormatReply(trimmed);
    if (parsed) {
      // Merge over any earlier card submit so partial typed answers keep
      // the defaults the user already had.
      inputs.collected = { ...(lastFormSubmission(history) ?? {}), ...parsed };
      return { phase: 'confirm', inputs };
    }
  }

  // Post-generation iteration. Previously ANY message after a generation was
  // forced to phase 'iterate', which only ever did a vague single-frame rewrite
  // of preview.html — so "换个风格" / "改内容" looked like nothing happened
  // (the user's recurring "后面的指令好像都没用了"). Instead, run a small
  // card-driven sub-flow: a vague "改一下" pops an edit-menu (change style /
  // content / duration); picking an option re-uses the existing style / content
  // / format cards; the final regeneration is based on the existing storyboard.
  if (hadGenerationYet(history)) {
    const last = lastAssistantCardWithMeta(history);
    // Mid-iteration: the user is answering one of the edit sub-flow cards.
    if (last?.metaPhase === 'edit-menu') {
      // Route the menu choice. Match by label keywords (works for clicks, which
      // send the option label, and for free text).
      if (/风格|style|视觉|配色|换个?样子/i.test(trimmed)) {
        inputs.pickedType = lastCardPickByPhase(history, 'type');
        return { phase: 'style', inputs, postGen: true };
      }
      if (/时长|时间|duration|长度|快|慢|秒|节奏/i.test(trimmed)) {
        inputs.pickedType = lastCardPickByPhase(history, 'type');
        return { phase: 'format', inputs, postGen: true };
      }
      // default / "内容 / content / 文案 / 主题 / 重写"
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = collectContentTurns(history);
      return { phase: 'content', inputs, postGen: true };
    }
    // The user is answering a re-shown card during iteration.
    if (last?.metaPhase === 'style') {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.pickedStyle = trimmed;
      return { phase: 'restyle', inputs, postGen: true };
    }
    if (last?.metaPhase === 'format' || last?.kind === 'hv-form') {
      inputs.collected = lastFormSubmission(history);
      return { phase: 'iterate-format', inputs, postGen: true };
    }
    if (last?.kind === 'content-question') {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed];
      return { phase: 'iterate-content', inputs, postGen: true };
    }
    // A fresh post-generation instruction. The DEFAULT is the card-driven
    // sub-flow, not a single-frame rewrite — a whitelist of trigger phrases was
    // the bug (e.g. "换个模板重新生成一下" didn't match and silently fell back to
    // a no-op preview rewrite). So:
    //   - pinned frame  → single-frame iterate (the user explicitly scoped it).
    //   - clearly names style / content / duration → jump straight there.
    //   - everything else (incl. vague "改一下" / "换个模板" / "重新生成") → pop
    //     the edit-menu and ask, rather than guess or no-op.
    const pinned = !!focusFrameId;
    if (pinned) {
      return { phase: 'iterate', inputs: { collected: lastFormSubmission(history) } };
    }
    // Direct shortcuts when the instruction is unambiguous about WHAT to change.
    if (/风格|样式|配色|视觉|主题色|模板|template|style|换个?样子|赛博|极简|杂志|brutal|cyber|swiss/i.test(trimmed)) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      return { phase: 'style', inputs, postGen: true };
    }
    if (/时长|时间|duration|时间长度|节奏|快一点|慢一点|更短|更长|多少秒/i.test(trimmed)) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      return { phase: 'format', inputs, postGen: true };
    }
    if (/文案|内容|主题|改成|换成|重写|讲|介绍|加.{0,4}(信息|数据|卖点)|text|content|rewrite/i.test(trimmed)) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed].filter((s) => !isControlPhrase(s));
      return { phase: 'iterate-content', inputs, postGen: true };
    }
    // Default: ask via the edit-menu (never silently no-op).
    return { phase: 'edit-menu', inputs };
  }

  // Walk backwards; what was the most recent CARD with a meta.phase tag?
  // (Skip empty / warning assistant turns.)
  const prev = lastAssistantCardWithMeta(history);

  if (!prev) {
    // No prior card → opener.
    return { phase: 'opener', inputs };
  }

  // Last card was an opener type-pick → user just answered with their type.
  if (prev.kind === 'hv-options' && prev.metaPhase === 'type') {
    inputs.pickedType = trimmed;
    // With source material already attached, there is nothing more to collect —
    // the article/repo IS the content. Skip the content-question step (which
    // otherwise stalls: the agent emits a statement, not an interactive card,
    // and the flow waits forever for a user reply that never comes) and go
    // straight to format (if a template is picked) or style.
    if (hasSourceMaterial) {
      inputs.contentTurns = collectContentTurns(history);
      return hasTemplate
        ? { phase: 'format', inputs }
        : { phase: 'style', inputs };
    }
    return { phase: 'content', inputs };
  }

  // Last card was a style-pick → user answered with style choice.
  if (prev.kind === 'hv-options' && prev.metaPhase === 'style') {
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.pickedStyle = trimmed;
    inputs.contentTurns = collectContentTurns(history);
    // "从设计模板选" but no template actually picked → don't silently fall back
    // to a default look; ask the user to pick one (top-bar) or choose a style.
    if (isFromTemplateStyle(trimmed) && !hasTemplate) {
      return { phase: 'need-template', inputs };
    }
    return { phase: 'format', inputs };
  }

  // User was told to pick a template (need-template card is an hv-options).
  if (prev.kind === 'hv-options' && prev.metaPhase === 'need-template') {
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.contentTurns = collectContentTurns(history);
    // Picked a built-in style instead → use it.
    if (!isFromTemplateStyle(trimmed) && !/^我已选好模板|继续|done|ready|next$/i.test(trimmed)) {
      inputs.pickedStyle = trimmed;
      return { phase: 'format', inputs };
    }
    // Said "I've picked one / continue": proceed only if a template is now set.
    if (hasTemplate) {
      inputs.pickedStyle = '从设计模板选';
      return { phase: 'format', inputs };
    }
    return { phase: 'need-template', inputs }; // still none → ask again
  }

  // Last card was content-question (a plain assistant message asking for content).
  // We detect this by phase metadata in a hidden HTML comment we embed.
  if (prev.kind === 'content-question') {
    // User is replying to content question. Could be (a) more content, or
    // (b) a "skip / I'm done" signal.
    const isSkip = /^(skip|跳过|够了|够|done|next|下一步|ok|好|不知道)$/i.test(trimmed)
      || trimmed.length <= 3;
    // "Free rein" answers — the user is handing the subject's details to the
    // agent ("随便生成 / 随便发挥 / 你定 / 都行 / 随机"). These should advance the
    // flow (and pop the style card) just like a skip, instead of being treated
    // as more content to collect — which left the user stuck re-typing "风格选择".
    // Substring match (not anchored) with a length guard so it doesn't swallow a
    // real sentence that merely contains "随便".
    const isFreeRein =
      trimmed.length <= 16 &&
      /(随便|随机|随意|你定|你来定|你决定|都行|都可以|看着办|自由发挥|发挥|无所谓|任意|随你)/.test(trimmed);
    // With source material attached there's nothing to collect — advance as
    // soon as the user says anything (the article already is the content).
    if (isSkip || isFreeRein || hasSourceMaterial || hasEnoughContent(history, trimmed)) {
      // Move forward: style if no template, else format.
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed];
      return hasTemplate
        ? { phase: 'format', inputs }
        : { phase: 'style', inputs };
    }
    // Continue chatting (still in content phase).
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.contentTurns = [...collectContentTurns(history), trimmed];
    return { phase: 'content', inputs };
  }

  // Default fallback: treat as iterate.
  inputs.collected = lastFormSubmission(history);
  return { phase: 'iterate', inputs };
}

/** Heuristic: how many content turns has the user given. Beyond 2 we move on. */
function hasEnoughContent(history: ChatMessage[], pending: string): boolean {
  const turns = collectContentTurns(history);
  return turns.length >= 2 || (turns.length >= 1 && pending.length > 60);
}

/** Find the most recent assistant card with a meta.phase, plus its kind. */
function lastAssistantCardWithMeta(history: ChatMessage[]): {
  kind: 'hv-options' | 'hv-form' | 'hv-confirm' | 'content-question';
  metaPhase: string | null;
} | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'assistant') continue;
    const c = m.content;
    if (!c.trim() || /^⚠️/.test(c.trim())) continue;
    // Try each card kind, JSON-parse the body, look for meta.phase.
    const cards: { kind: 'hv-options' | 'hv-form' | 'hv-confirm'; re: RegExp }[] = [
      { kind: 'hv-confirm', re: /```hv-confirm\s*\n([\s\S]*?)```/i },
      { kind: 'hv-form',    re: /```hv-form\s*\n([\s\S]*?)```/i },
      { kind: 'hv-options', re: /```hv-options\s*\n([\s\S]*?)```/i },
    ];
    for (const { kind, re } of cards) {
      const match = re.exec(c);
      if (match && match[1]) {
        let metaPhase: string | null = null;
        try {
          const parsed = JSON.parse(match[1].trim());
          metaPhase = parsed?.meta?.phase ?? null;
        } catch { /* unparseable card body — treat as untagged */ }
        return { kind, metaPhase };
      }
    }
    // No card → was this a content-question? Look for our marker.
    if (/<!--\s*hv-phase:content-question\s*-->/i.test(c)) {
      return { kind: 'content-question', metaPhase: 'content' };
    }
    // A real assistant turn with no card and no marker — bail.
    return null;
  }
  return null;
}

/** Look back for the user message that answered an hv-options card with meta.phase=X. */
function lastCardPickByPhase(history: ChatMessage[], phase: string): string | undefined {
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i]!;
    const u = history[i + 1]!;
    if (a.role !== 'assistant' || u.role !== 'user') continue;
    const m = /```hv-options\s*\n([\s\S]*?)```/i.exec(a.content);
    if (!m || !m[1]) continue;
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed?.meta?.phase === phase) return u.content.trim();
    } catch { /* ignore */ }
  }
  return undefined;
}

/** All free-text user replies during the content phase (between type-pick and style/format). */
/** A short user turn that just nudges the flow forward ("continue", "go",
 *  "下一步", "开始生成") rather than supplying video content. Such turns must
 *  not be collected as content — otherwise they end up as on-screen text. */
function isControlPhrase(t: string): boolean {
  const s = t.trim().toLowerCase().replace(/[。.!！~\s]+$/u, '');
  if (s.length > 12) return false; // real content is longer; keep it
  return /^(继续|继续(刚刚|上次|之前)的?任务|接着|接着(来|做|生成)|下一步|开始(生成)?|生成(吧)?|go|continue|next|start|ok|好的?|行|走|动手|可以|确认)$/u.test(s);
}

function collectContentTurns(history: ChatMessage[]): string[] {
  const out: string[] = [];
  let inContent = false;
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.role === 'assistant') {
      const c = m.content;
      // Type pick assistant card opens content phase
      const typeMatch = /```hv-options\s*\n([\s\S]*?)```/i.exec(c);
      if (typeMatch && typeMatch[1]) {
        try {
          const parsed = JSON.parse(typeMatch[1].trim());
          if (parsed?.meta?.phase === 'type') { inContent = true; continue; }
          if (parsed?.meta?.phase === 'style') { inContent = false; continue; }
        } catch { /* ignore */ }
      }
      if (/```hv-form\s*\n/i.test(c)) inContent = false;
      continue;
    }
    if (m.role !== 'user') continue;
    if (!inContent) continue;
    const t = m.content.trim();
    if (!t) continue;
    if (t.startsWith('[hv-')) continue; // skip marker messages
    // Skip control phrases ("continue / next / go / 开始生成 …"). These are the
    // user nudging the flow forward, NOT video content — otherwise e.g.
    // "继续刚刚的任务" gets baked in as the opening frame's headline.
    if (isControlPhrase(t)) continue;
    // Skip the "trimmed answer" that picks the type — it's the first user turn
    // immediately after the type card; keep only later ones.
    if (out.length === 0) {
      // The very first user turn after a type card IS the type pick. Skip it.
      // (Subsequent turns in content phase get collected.)
      out.push('__TYPE_PICK__');
      continue;
    }
    out.push(t);
  }
  return out.filter((t) => t !== '__TYPE_PICK__');
}

/**
 * The video's LOCKED subject, in the user's own words. The opening message
 * ("帮我生成一个关于 Open Design 的介绍视频") names the subject, but it never
 * reached the generate / storyboard prompts: collectContentTurns() only keeps
 * turns after the type-pick card, so a later vague answer like "随机" became the
 * entire content input and the video came out about randomness instead of Open
 * Design. This recovers the opening subject so every downstream prompt can lock
 * onto it.
 *
 * Prefer the persisted project.intent, but the studio UI creates projects with
 * a name only (intent is almost always empty), so fall back to the first user
 * message in history — which is the genuine opening request. Strip the
 * attachment summary suffix appended to message content.
 */
function resolveOpeningTopic(project: { intent?: string }, history: ChatMessage[]): string {
  const fromIntent = project.intent?.trim();
  if (fromIntent) return fromIntent.slice(0, 200);
  const firstUser = history.find((m) => m.role === 'user')?.content ?? '';
  const clean = (firstUser.split('\n\n📎')[0] ?? '').trim();
  // Don't lock onto a bare control phrase ("继续" / "ok") if that's somehow first.
  if (!clean || isControlPhrase(clean)) return '';
  return clean.slice(0, 200);
}

// Legacy helper retained for backward calls — now delegates to detectPhase's
// metadata-aware lookup.
function lastAssistantCardKind(history: ChatMessage[]): 'hv-options' | 'hv-form' | 'hv-confirm' | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'assistant') continue;
    if (/```hv-confirm\s*\n/i.test(m.content)) return 'hv-confirm';
    if (/```hv-form\s*\n/i.test(m.content)) return 'hv-form';
    if (/```hv-options\s*\n/i.test(m.content)) return 'hv-options';
    // Skip empty / warning-only assistant turns — the live card is one further back.
    if (!m.content.trim()) continue;
    if (/^⚠️/.test(m.content.trim())) continue;
    // A real assistant message with no card resets the search.
    return null;
  }
  return null;
}

function lastFormSubmission(history: ChatMessage[]): Record<string, string> | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'user') continue;
    const match = /^\[hv-form:submit\]\s*\n([\s\S]+)$/.exec(m.content.trim());
    if (match && match[1]) {
      try { return JSON.parse(match[1]); } catch { /* keep scanning */ }
    }
  }
  return undefined;
}

/** Has a successful generation already happened in this conversation? */
function hadGenerationYet(history: ChatMessage[]): boolean {
  // Only count a real storyboard/video generation, not any assistant turn that
  // happens to contain a "✓". The old broad check (`✓\s`) matched the persisted
  // summary lines of the iteration sub-flow itself, so once you'd generated, the
  // flow could never leave 'iterate'. Look for concrete generation markers.
  return history.some(
    (m) =>
      m.role === 'assistant' &&
      /```json#content-graph|故事板规划完成|storyboard (generated|regenerated|restyled)|帧完成|frame .* (done|完成)/i.test(m.content),
  );
}

/**
 * Was the most recent assistant turn asking the user for format params
 * (aspect / duration / frame count)? True for the proper `hv-form` card AND
 * for the prose fallback the model sometimes emits instead. Used to decide
 * whether a free-text user reply should be parsed as a format answer.
 */
function lastAssistantAskedFormat(history: ChatMessage[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'assistant') continue;
    const c = m.content;
    if (!c.trim() || /^⚠️/.test(c.trim())) continue; // skip empty / warning turns
    // The real hv-form card.
    const form = /```hv-form\s*\n([\s\S]*?)```/i.exec(c);
    if (form?.[1]) {
      try { return JSON.parse(form[1].trim())?.meta?.phase === 'format'; } catch { return true; }
    }
    // Prose fallback: the turn talks about size/duration/frames without a card.
    // Require at least two of the three concepts so an unrelated mention of
    // "时长" elsewhere doesn't trigger it.
    const hits = [/尺寸|横屏|竖屏|方形|aspect|比例/i, /时?长|秒|duration|\bs\b/i, /帧|frames?/i]
      .filter((re) => re.test(c)).length;
    return hits >= 2;
  }
  return false;
}

/**
 * Best-effort parse of format params from a FREE-TEXT user reply.
 *
 * The format step is supposed to render an `hv-form` card (segmented buttons)
 * whose submit carries an explicit `[hv-form:submit]` marker. But the model
 * sometimes ignores that instruction and instead asks for the params in prose
 * ("9:16 竖屏 / 3s / 6 …"); the user then types the answer free-form, with no
 * marker. Without this parser the state machine can't tell the params were
 * already given, so it loops — re-asking the same thing in a different shape
 * (issue #2). We extract aspect / duration / frame_count heuristically so a
 * typed reply is treated the same as a card submit.
 *
 * Returns undefined when the text carries no recognisable format signal, so
 * callers can fall through to other phase logic.
 */
export function parseFormatReply(text: string): Record<string, string> | undefined {
  const t = text.trim();
  if (!t || t.length > 80) return undefined; // long text is content, not a format answer
  const out: Record<string, string> = {};

  // --- aspect: explicit ratio (16:9 / 9:16 / 1:1 / 4:5) or a keyword ---
  const ratio = /\b(16\s*[:：]\s*9|9\s*[:：]\s*16|1\s*[:：]\s*1|4\s*[:：]\s*5)\b/.exec(t);
  const ratioNorm = ratio?.[1]?.replace(/\s/g, '').replace('：', ':');
  if (ratioNorm === '16:9' || /横屏|landscape|宽屏/i.test(t)) out.aspect = '16:9 横屏';
  else if (ratioNorm === '9:16' || /竖屏|手机|portrait|vertical/i.test(t)) out.aspect = '9:16 手机竖屏';
  else if (ratioNorm === '1:1' || /方形|square/i.test(t)) out.aspect = '1:1 方形';
  else if (ratioNorm === '4:5' || /小红书|xiaohongshu|rednote/i.test(t)) out.aspect = '4:5 小红书';

  // --- duration: a number directly tied to seconds (5s / 5秒 / 5 sec) ---
  const dur = /(\d{1,3})\s*(?:s\b|秒|sec)/i.exec(t);
  if (dur?.[1]) out.duration = dur[1];

  // --- frame_count: a number tied to 帧/frame, or the lone trailing number in
  //     a "a / b / c" triple where a=ratio, b=duration. ---
  const fr = /(\d{1,2})\s*(?:帧|frames?)\b/i.exec(t);
  if (fr?.[1]) out.frame_count = fr[1];
  else {
    // "16:9 横屏 / 5s / 10" — after stripping ratio+duration tokens, a bare
    // small integer left over is the frame count.
    const parts = t.split(/[/、,，]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const bare = /^(\d{1,2})\s*帧?$/.exec(last);
      if (bare?.[1] && !/[:：s秒]/.test(last)) out.frame_count = bare[1];
    }
  }

  // Need at least one positively-identified signal to count as a format reply.
  return Object.keys(out).length > 0 ? out : undefined;
}

function lastTypePick(history: ChatMessage[]): string | undefined {
  // The first user turn that immediately follows the opener hv-options card.
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i]!;
    const u = history[i + 1]!;
    if (a.role === 'assistant' && u.role === 'user' && /```hv-options\s*\n/i.test(a.content)) {
      return u.content.trim();
    }
  }
  return undefined;
}

/**
 * Render one attachment for the prompt. Text sources with inlined content get
 * their actual content fenced inline (so HTTP agents that can't read local
 * disk still see it); binary/path-only attachments stay a one-line reference.
 */
function renderAttachment(a: Attachment): string[] {
  if (a.inlineText) {
    return [
      `- [${a.kind}] ${a.filename} — full content below:`,
      '```',
      a.inlineText,
      '```',
    ];
  }
  return [`- [${a.kind}] ${a.filename} — ${a.path}`];
}

/** A design.md / frame.md / DESIGN.md attachment is a brand + motion SPEC the
 *  video must FOLLOW (palette, type, tokens, pacing/scale/dwell/motion), not
 *  content to be narrated. Detect by filename or by the spec's tell-tale
 *  headings, so users can drop in a design.md (portable design system) or
 *  HeyGen-style frame.md (motion spec). */
function isDesignSpec(a: Attachment): boolean {
  const name = (a.filename || '').toLowerCase();
  if (/(^|\/)(design|frame)\.md$/.test(name) || /\bframe\.md\b|\bdesign\.md\b/.test(name)) return true;
  const txt = a.inlineText ?? '';
  if (!txt) return false;
  // Heading/section fingerprints shared by design.md & frame.md specs.
  return /#\s*(design|frame)\s*[—\-]/i.test(txt)
    || /(^|\n)##\s*(System|Theme|Tokens|Motion|Pacing|Composition)\b/i.test(txt)
    || /\b(pacing|dwell)\b.*\b(scale|motion)\b/i.test(txt);
}

/** Split attachments into design/motion specs vs ordinary source material. */
function partitionAttachments(atts: Attachment[]): { specs: Attachment[]; content: Attachment[] } {
  const specs: Attachment[] = [];
  const content: Attachment[] = [];
  for (const a of atts) (a.inlineText && isDesignSpec(a) ? specs : content).push(a);
  return { specs, content };
}

/** Prompt block telling the agent to OBEY a design/frame spec. */
function renderDesignSpecBlock(specs: Attachment[]): string[] {
  if (!specs.length) return [];
  const out: string[] = [
    `DESIGN SYSTEM / MOTION SPEC (REQUIRED — obey this for every frame): the file(s)`,
    `below define the brand's visual + motion language. Honour their palette,`,
    `typography, tokens, layout AND any motion direction (pacing, scale, dwell,`,
    `motion) over your own defaults. This is HOW the video must look/move; the`,
    `actual subject still comes from the user's content.`,
  ];
  for (const a of specs) {
    out.push(`--- ${a.filename} ---`);
    out.push((a.inlineText ?? '').slice(0, 6000));
  }
  out.push('');
  return out;
}

/** LLMs emit not-quite-valid JSON for the content-graph more often than not:
 *  trailing commas, and (now that we ask them to quote article terms) stray
 *  straight double-quotes inside string values. Try strict parse first, then
 *  escalate through cheap, safe repairs before giving up. */
function parseGraphJsonTolerant(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to repairs */
  }
  // 1) Strip trailing commas before } or ] — the most common LLM slip.
  const noTrailing = raw.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(noTrailing);
  } catch {
    /* fall through */
  }
  // 2) Escape stray straight double-quotes inside synopsis/text string values
  //    (e.g. text: "the "harness" idea"). Operate on the trailing-comma-cleaned
  //    text; for each "<key>": "<value>" pair, re-escape any bare " in <value>.
  const repaired = noTrailing.replace(
    /("(?:synopsis|text)"\s*:\s*")([\s\S]*?)("\s*(?:,|\}|\]))/g,
    (_m, pre: string, val: string, post: string) =>
      pre + val.replace(/\\?"/g, '\\"') + post,
  );
  return JSON.parse(repaired); // if this still throws, caller reports it
}

/** A content type is multi-frame UNLESS it's an explicitly single-frame kind
 *  (title card / cover / single still). Whitelisting "讲解/explainer/…" was too
 *  narrow — e.g. "概念解说短片" (解说, not 讲解) fell through to single-frame.
 *  Inverting the test makes new/renamed multi-frame types default correctly. */
function isMultiFrameType(pickedType: string): boolean {
  if (!pickedType) return false;
  const single = /单帧|单画面|标题卡|封面|logo|title.?card|single.?frame|cover|still/i.test(pickedType);
  return !single;
}

function buildHtmlGenerationPrompt(args: BuildPromptArgs): string {
  const { tmpl, exampleHtml, priorHtml, history, userText, attachments, openingTopic } = args;

  // When a template is selected, its own source HTML is the style ground truth —
  // NOT a prior render. Otherwise a project that was previously rendered in some
  // other look would keep feeding that stale look back in as "the style to draw
  // from", and the freshly-picked template gets ignored. Only fall back to
  // priorHtml (iterate-on-last-render) when no template is in play.
  const baseHtml = tmpl
    ? exampleHtml
    : (priorHtml && priorHtml !== exampleHtml ? priorHtml : exampleHtml);
  const trimmed = userText.trim();
  // A fetched article / repo / uploaded doc carries inlined content — that IS
  // the topic, so we should not interrogate the user about what the video is
  // about. The source rides into every phase's prompt via `attachments`.
  const hasSourceMaterial = attachments.some((a) => !!a.inlineText);
  const { phase, inputs } = detectPhase(history, userText, !!tmpl, hasSourceMaterial, args.focusFrameId ?? '');

  // ---- edit-menu: post-generation "what do you want to change?" card ----
  if (phase === 'edit-menu') {
    const em: string[] = [];
    em.push(`The user wants to change the already-generated video but hasn't said what. Reply with ONE short line in their language asking what to change, then ONE fenced \`\`\`hv-options block. Use this EXACT JSON — keep "meta" verbatim:`);
    em.push('```hv-options');
    em.push(JSON.stringify({
      meta: { phase: 'edit-menu' },
      question: '想改哪方面？',
      options: [
        { label: '🎨 换风格', hint: '保留内容，换一套视觉风格' },
        { label: '✏️ 改内容', hint: '改文案 / 主题 / 重写脚本' },
        { label: '⏱️ 改时长', hint: '调整每帧时长 / 节奏' },
      ],
      allow_freeform: true,
    }, null, 2));
    em.push('```');
    em.push('');
    em.push(`Do NOT write HTML this turn. Do NOT return an empty reply. The hv-options block is REQUIRED.`);
    return em.join('\n');
  }

  // ---- opener: hv-options card with meta.phase = "type" ----
  if (phase === 'opener') {
    const opener: string[] = [];
    opener.push(
      `The user just opened a project and said "${trimmed}". You are an HTML-video creation assistant.`,
    );
    opener.push('');
    opener.push(`Reply with TWO things, in this exact order:`);
    opener.push(`1. ONE friendly opening sentence in the user's language (≤ 25 chars).`);
    opener.push(`2. A fenced \`\`\`hv-options block with the 4 content-type choices below. JSON shape EXACTLY as shown — do not change keys or omit "meta":`);
    opener.push('```hv-options');
    opener.push(JSON.stringify({
      meta: { phase: 'type' },
      question: '想做哪种内容？',
      options: [
        { label: '单帧标题卡',   hint: 'logo / 封面 / 单画面 - 5-10s' },
        { label: '多帧预告片',   hint: '产品 / 活动 teaser, 3-6 帧' },
        { label: '数据大字报',   hint: '1-2 个核心数字, 社媒爆款风' },
        { label: '概念解说短片', hint: '几帧讲清一个 idea / feature' },
      ],
      allow_freeform: true,
    }, null, 2));
    opener.push('```');
    opener.push('');
    if (tmpl) {
      opener.push(
        `Note: a template "${tmpl.name}" is currently selected (${tmpl.description}). Treat it as a visual style reference only — content type still drives the structure.`,
      );
      opener.push('');
    }
    opener.push(`Do NOT write HTML this turn. Do NOT return an empty reply. The hv-options block is REQUIRED.`);
    return opener.join('\n');
  }

  // ---- content: free chat asking about topic / headline / data ----
  if (phase === 'content') {
    const pickedType = inputs.pickedType ?? '';
    const turns = inputs.contentTurns ?? [];
    const p: string[] = [];

    // Source material present → DON'T interrogate. The article/repo content is
    // the topic; acknowledge it and let the flow advance to style/format.
    if (hasSourceMaterial) {
      p.push(`The user is making a ${pickedType ? `"${pickedType}"` : 'video'} based on the source material below — do NOT ask them what it's about, the content is already provided.`);
      p.push('');
      for (const a of attachments) p.push(...renderAttachment(a));
      p.push('');
      p.push(`In the user's language, write ONE short line that names the actual topic/title you read from the source and states the video will be built from it (e.g. "好，我读完了《…》这篇文章 — 这就基于它生成。下一步选风格。"). Do NOT ask the user to retype or summarize anything. End with this hidden marker on its own line:`);
      p.push('<!-- hv-phase:content-question -->');
      p.push('');
      p.push(`Plain text + the marker only. NO code blocks. NO questions. Do NOT return an empty reply.`);
      return p.join('\n');
    }

    p.push(`The user is making a ${pickedType ? `"${pickedType}"` : 'video'}. Collect concrete content for it via natural conversation — DO NOT emit any code block, hv-options, hv-form, or hv-confirm. End your reply with this hidden marker on its own line so the server knows you're still in the content phase:`);
    p.push('<!-- hv-phase:content-question -->');
    p.push('');
    p.push(`Goal: surface what the video is ABOUT (topic, brand / project name, headline / tagline, key numbers or data points). The user can answer, partially answer, or say "随便发挥 / skip / 不知道" — accept whatever they give and move on.`);
    p.push('');
    // The user's opening request already names the subject (e.g. "做一个 Open
    // Design 推广视频"). Lock onto it: don't let a vague follow-up answer like
    // "随机/随便/anything" silently become a literal NEW topic — that's how a
    // "promote Open Design" request turned into a probability explainer.
    {
      const openingTopic = history.find((m) => m.role === 'user')?.content?.trim().slice(0, 200);
      if (openingTopic) {
        p.push(`The user's ORIGINAL opening request was: "${openingTopic}". Treat this as the LOCKED subject of the video unless the user clearly asks to change it.`);
        p.push(`If the user's answer this turn CONTRADICTS or seems unrelated to that subject (e.g. they opened with a product/brand video but now answer with an off-topic word), do NOT silently switch topics. Ask ONE short clarifying question: keep the original subject (with the new word as a detail/example/angle), or genuinely change the subject? Treat vague answers like "随机 / 随便 / anything / 你定 / whatever" as "you decide the details, KEEP the original subject" — never as a literal new topic.`);
        p.push('');
      }
    }
    if (turns.length === 0) {
      p.push(`This is the first content turn. Ask 1–3 short, sharp questions, in the user's language. Keep it under 60 words. Mention they can answer fully, partially, or just say "skip" / "随便".`);
    } else {
      p.push(`The user has already shared:`);
      for (const t of turns) p.push(`  - ${t.slice(0, 200)}`);
      p.push('');
      p.push(`Either ask ONE more clarifying question, or — if you have enough — write a one-line confirmation like "好，我有思路了，下一步是风格" / "Got it. Next: style." and end with the marker. The server will move on to style automatically when your reply is short / affirmative or when this is your second clarifying round.`);
    }
    p.push('');
    p.push(`Reply in plain text + the marker. NO code blocks. Do NOT return an empty reply.`);
    return p.join('\n');
  }

  // ---- style: hv-options card with style presets + "pick template" + freeform ----
  if (phase === 'style') {
    const pickedType = inputs.pickedType ?? '';
    const p: string[] = [];
    p.push(`The user has shared their content for a "${pickedType}". Now ask them about visual style with ONE hv-options card. JSON shape EXACTLY as shown — keep "meta" verbatim:`);
    p.push('```hv-options');
    p.push(JSON.stringify({
      meta: { phase: 'style' },
      question: '视觉风格怎么定？',
      options: [
        { label: 'Cyberpunk glitch',   hint: '霓虹 / 故障感 / 高对比' },
        { label: 'Swiss minimalist',   hint: '网格 / 无衬线 / 留白' },
        { label: 'Warm-grain magazine',hint: '纸感 / 衬线 / 暖色' },
        { label: 'Mono brutalist',     hint: '黑白 / 块状 / 粗体' },
        { label: '从设计模板选',       hint: '上方挑一个现成模板' },
      ],
      allow_freeform: true,
    }, null, 2));
    p.push('```');
    p.push('');
    p.push(`Add ONE short sentence above the card in the user's language inviting them to pick or describe a vibe. Mention they can also upload a reference image via the 📎 button.`);
    p.push('');
    p.push(`Do NOT write HTML this turn. Do NOT return an empty reply.`);
    return p.join('\n');
  }

  // ---- need-template: user chose "from design template" but hasn't picked one
  if (phase === 'need-template') {
    const p: string[] = [];
    p.push(`The user chose "从设计模板选" (use a design template) but has NOT selected a template yet. Do NOT generate. Tell them — in their language, ONE short friendly line — to pick a template from the top-bar 模板 / Template dropdown, then offer this card so they can confirm once they've picked, or switch to a built-in style instead. JSON shape EXACTLY — keep "meta" verbatim:`);
    p.push('```hv-options');
    p.push(JSON.stringify({
      meta: { phase: 'need-template' },
      question: '先在顶部「模板」里选一个模板，选好后点下面继续；或直接选一种内置风格：',
      options: [
        { label: '我已选好模板，继续', hint: '用顶部选中的模板生成' },
        { label: 'Cyberpunk glitch',   hint: '霓虹 / 故障感 / 高对比' },
        { label: 'Swiss minimalist',   hint: '网格 / 无衬线 / 留白' },
        { label: 'Warm-grain magazine',hint: '纸感 / 衬线 / 暖色' },
        { label: 'Mono brutalist',     hint: '黑白 / 块状 / 粗体' },
      ],
      allow_freeform: true,
    }, null, 2));
    p.push('```');
    p.push('');
    p.push(`Do NOT write HTML this turn. Do NOT return an empty reply.`);
    return p.join('\n');
  }

  // ---- format / format-edit: hv-form with 3 segmented controls ----
  if (phase === 'format' || phase === 'format-edit') {
    const isEdit = phase === 'format-edit';
    const pre = inputs.collected ?? {};
    const pickedType = isEdit
      ? lastCardPickByPhase(history, 'type') ?? ''
      : (inputs.pickedType ?? '');
    const isMulti = !!pickedType && isMultiFrameType(pickedType);
    const defaults = {
      aspect:      pre.aspect      ?? '16:9 横屏',
      duration:    pre.duration    ?? (isMulti ? '15' : '5'),
      frame_count: pre.frame_count ?? (isMulti ? '4' : '1'),
      // Per-frame pacing default 4s — comfortable, avoids the "rushed" feel a
      // short total ÷ many frames produces. Total is derived from this × frames.
      per_frame:   pre.per_frame   ?? '4',
    };
    const p: string[] = [];
    if (isEdit) {
      p.push(`The user wants to revise the format. Re-emit the SAME hv-form card with each \`default\` set to their last answer so they only need to change what they want.`);
    } else {
      p.push(`Now ask about format with ONE hv-form card — three segmented controls, no text inputs. JSON shape EXACTLY as shown — keep "meta" verbatim:`);
    }
    // The card is the ONLY acceptable way to ask this. Asking in prose makes
    // the user type a free-form answer with no submit marker, which the flow
    // then fails to recognise and re-asks (issue #2).
    p.push(`IMPORTANT: emit the hv-form card below — do NOT ask for size / duration / frames in plain prose, and do NOT list example answers for the user to type.`);
    p.push('```hv-form');
    p.push(JSON.stringify({
      meta: { phase: 'format' },
      title: isEdit ? '改一下格式' : (isMulti ? '最后一步：尺寸 / 每帧时长 / 帧数' : '最后一步：选个尺寸 / 时长'),
      fields: [
        {
          key: 'aspect', label: '画面尺寸', kind: 'buttons', required: true,
          default: defaults.aspect,
          options: [
            { value: '16:9 横屏',     label: '16:9 横屏' },
            { value: '9:16 手机竖屏', label: '9:16 竖屏' },
            { value: '1:1 方形',      label: '1:1 方形' },
            { value: '4:5 小红书',    label: '4:5 小红书' },
          ],
        },
        // Multi-frame: pace by PER-FRAME duration (total = per_frame × frames,
        // shown live). Single-frame: just a total duration.
        ...(isMulti
          ? [
              {
                key: 'per_frame', label: '每帧时长 (秒)', kind: 'buttons', required: true,
                default: defaults.per_frame,
                hint: '总时长 = 每帧时长 × 帧数',
                options: ['2', '3', '4', '5', '6', '8'].map((v) => ({ value: v, label: `${v}s` })),
              },
              {
                key: 'frame_count', label: '帧数', kind: 'buttons', required: true,
                default: defaults.frame_count,
                options: ['2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => ({ value: v, label: v })),
              },
              // Opt-in: render data frames natively with Remotion (numbers roll,
              // bars grow) instead of static hyperframes HTML. Default OFF —
              // Remotion is a user-chosen enhancement, the AI never flips it.
              {
                key: 'remotion_enhance', label: '⚡ 数据帧用 Remotion', kind: 'buttons', required: false,
                default: '关',
                hint: '数据帧用原生 Remotion 渲染（数字滚动 / 柱子生长）；其余帧仍走 Hyperframes',
                options: [
                  { value: '关', label: '关' },
                  { value: '开', label: '开 · Remotion' },
                ],
              },
            ]
          : [
              {
                key: 'duration', label: '时长 (秒)', kind: 'buttons', required: true,
                default: defaults.duration,
                options: ['3', '5', '10', '15'].map((v) => ({ value: v, label: `${v}s` })),
              },
            ]),
      ],
      allow_attachments: false,
    }, null, 2));
    p.push('```');
    p.push('');
    p.push(`Do NOT write HTML this turn. Do NOT return an empty reply.`);
    return p.join('\n');
  }

  // ---- confirm: emit hv-confirm summarising what was collected ----
  if (phase === 'confirm') {
    const collected = inputs.collected ?? {};
    const pickedType = lastCardPickByPhase(history, 'type') ?? '';
    const pickedStyle = lastCardPickByPhase(history, 'style') ?? '';
    const contentTurns = collectContentTurns(history);
    const summaryRows: { label: string; value: string }[] = [];
    if (pickedType) summaryRows.push({ label: '类型', value: pickedType });
    if (contentTurns.length > 0) {
      summaryRows.push({ label: '内容', value: contentTurns.join(' · ').slice(0, 240) });
    }
    if (pickedStyle) summaryRows.push({ label: '风格', value: pickedStyle });
    if (tmpl) summaryRows.push({ label: '模板', value: tmpl.name });
    const labelMap: Record<string, string> = {
      aspect: '尺寸', duration: '时长', frame_count: '帧数', per_frame: '每帧时长',
    };
    // When pacing by per-frame, show per-frame + frames + derived total.
    const pf = Number(collected.per_frame ?? '') || 0;
    const keys = pf > 0 ? ['aspect', 'per_frame', 'frame_count'] : ['aspect', 'duration', 'frame_count'];
    for (const k of keys) {
      const v = collected[k];
      if (v) summaryRows.push({ label: labelMap[k] ?? k, value: k === 'per_frame' ? `${v}s` : v });
    }
    if (pf > 0) {
      const frames = Number(collected.frame_count ?? '4') || 4;
      summaryRows.push({ label: '总时长', value: `${pf * frames}s` });
    }
    if (attachments.length > 0) {
      summaryRows.push({ label: '素材', value: attachments.map((a) => a.filename).join(', ') });
    }

    const p: string[] = [];
    p.push(`The user has chosen the format. Emit ONE \`\`\`hv-confirm block (no other code blocks) summarising what you've got, in the user's language. Use this exact JSON — keep "meta":`);
    p.push('');
    p.push('```hv-confirm');
    p.push(JSON.stringify({
      meta: { phase: 'confirm' },
      title: '按这些信息生成？',
      summary: summaryRows,
      actions: ['generate', 'edit'],
    }, null, 2));
    p.push('```');
    p.push('');
    // Soft gate: if the subject is too thin to make a meaningful video, nudge
    // the user to add a concrete topic/brand/number — but never block, the card
    // still ships with both actions so they can proceed as-is.
    const contentBlob = contentTurns.join(' ').trim();
    const topicThin =
      attachments.length === 0 &&
      (contentBlob.replace(/\s/g, '').length < 8 ||
        /^(随机|随便|anything|random|whatever|都行|你定|skip|不知道)$/i.test(contentBlob));
    if (topicThin) {
      p.push(`NOTE: the collected content ("${contentBlob || '(empty)'}") is very thin / vague. BEFORE the hv-confirm block, add ONE short friendly sentence in the user's language gently flagging that the topic is sparse and inviting them to add a concrete subject / brand / key number for a stronger video — but STILL emit the hv-confirm block exactly as above so they can generate anyway if they want.`);
      p.push('');
    }
    p.push(`Do NOT write HTML this turn. Do NOT return an empty reply. The hv-confirm block is REQUIRED.`);
    return p.join('\n');
  }

  // ---- generate: actually write the HTML / content-graph ----
  if (phase === 'generate') {
    const collected = inputs.collected ?? {};
    const pickedType = inputs.pickedType ?? '';
    const pickedStyle = inputs.pickedStyle ?? '';
    const contentTurns = inputs.contentTurns ?? [];
    const aspect = ((collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9'); // strip "16:9 横屏" → "16:9"
    const [w, h] = aspect.includes(':') ? aspect.split(':').map(Number) : [16, 9];
    const isMulti = isMultiFrameType(pickedType)
      || Number(collected.frame_count ?? '1') > 1
      || Number(collected.per_frame ?? '0') > 0;

    // Pick a concrete pixel resolution that respects the aspect choice.
    let resolution = '1920×1080';
    if (aspect === '9:16') resolution = '1080×1920';
    else if (aspect === '1:1') resolution = '1080×1080';
    else if (aspect === '4:5') resolution = '1080×1350';

    const styleLabel = pickedStyle && /^从设计模板选|template/i.test(pickedStyle)
      ? (tmpl ? `(use the selected template "${tmpl.name}" — ${tmpl.description})` : '(let the model choose)')
      : pickedStyle;

    const p: string[] = [];
    p.push(`Generate the HTML video file(s) the user just confirmed.`);
    p.push('');
    // Lock the subject to the user's opening request. The content turns below
    // can be as thin as "随机" — without this the video drifts onto that literal
    // word (a "promote Open Design" request became a randomness explainer).
    if (openingTopic) {
      p.push(`VIDEO SUBJECT (LOCKED): the user opened with "${openingTopic}". The video MUST be about THIS subject.`);
      p.push(`If a content line below is a vague placeholder like "随机 / 随便 / anything / 你定 / whatever", it means "YOU choose the concrete details (selling points, framing, copy) — but the SUBJECT stays "${openingTopic}"". NEVER treat "随机" as the literal topic; do NOT make a video about randomness.`);
      p.push('');
    }
    p.push(`Inputs (use these LITERALLY — do NOT make up brand names or facts beyond what is stated):`);
    p.push(`- 类型 / type: ${pickedType || '(未指定)'}`);
    if (contentTurns.length > 0) {
      p.push(`- 内容 / content (what the user told us in the chat):`);
      for (const t of contentTurns) p.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
    } else {
      p.push(`- 内容 / content: (the user did not specify; pick a sensible default that fits the type, but keep it generic — no fake brand names)`);
    }
    if (styleLabel) p.push(`- 风格 / style: ${styleLabel}`);
    p.push(`- 画面尺寸: ${aspect} (${resolution})`);
    p.push(`- 时长: ${collected.duration ?? '?'} 秒`);
    p.push(`- 帧数: ${collected.frame_count ?? (isMulti ? '4' : '1')}`);
    p.push('');
    if (attachments.length > 0) {
      const { specs, content } = partitionAttachments(attachments);
      // A design.md / frame.md is a style+motion spec to OBEY, surfaced first.
      p.push(...renderDesignSpecBlock(specs));
      if (content.length > 0 || specs.length === 0) {
        p.push(`Attachments:`);
        for (const a of (content.length ? content : attachments)) p.push(...renderAttachment(a));
        p.push(`Use binary attachments (images, data files) as actual assets where appropriate (logo, screenshot, data file). The inlined text/article/repo content above is the SOURCE MATERIAL — base the video's actual content (facts, names, numbers, narrative) on it, don't just decorate with it.`);
        p.push('');
      }
    }
    p.push(`Constraints: full-bleed ${resolution}, opens with an animation timeline, inline CSS + JS, single complete <!doctype html>...</html> document(s). CDN imports (Tailwind, GSAP) are fine. Tag every visible text node with data-hv-text set to a stable key (brand_name, headline, item_1, cta…). No prose outside code blocks.`);
    p.push('');
    // Frame-count safety: claude --print can truncate / stall on very large
    // multi-frame batches. Cap at 10 (high frame counts get progressively
    // less reliable in a single pass), and tell the model so it can plan.
    const requestedFrames = Math.max(1, Math.min(10, Number(collected.frame_count ?? '4') || 4));
    // ⚠️ FALLBACK ONLY. Real multi-frame generation goes through
    // runSplitMultiFrameGenerate (the server routes frame_count>1 there before
    // ever reaching this single-shot prompt). This branch only fires if that
    // routing is bypassed. If you change multi-frame grounding / template /
    // source-material rules, change runSplitMultiFrameGenerate — that's the
    // path users actually hit. Keep the two in sync.
    if (isMulti) {
      p.push(`Output (multi-frame storyboard) — emit IN THIS EXACT ORDER and SHAPE:`);
      p.push(`1. ONE \`\`\`json#content-graph block.`);
      p.push(`2. ONE \`\`\`html#<nodeId> block per node.`);
      p.push('');
      p.push(`Aim for ${requestedFrames} frames. Each frame should be self-contained, full-bleed ${resolution}, with its own opening animation. Nothing between blocks.`);
      p.push('');
      if (attachments.length > 0) {
        // The agent has, in practice, been handed the full article yet fallen
        // back to generic "first-principles / see-the-essence" filler. Force it
        // to ground every node in the source material's actual specifics.
        p.push(`GROUNDING (REQUIRED — the source material above is the script, not decoration):`);
        p.push(`- EVERY node's "text" MUST quote or paraphrase a SPECIFIC fact, name, number, product, or claim from the source material. Pull the real proper nouns (product names, companies, metrics, version numbers) verbatim.`);
        p.push(`- The "synopsis" MUST name the article's actual subject — not "AI/technology trends" or any vague category.`);
        p.push(`- BANNED: generic motivational filler with no tie to the source ("看清本质", "第一性原理", "复杂表象之下", "you really understand…", "the logic behind…"). If a line would fit ANY article, it is wrong — replace it with something that could ONLY come from THIS source.`);
        p.push(`- A reader who knows the article must recognize each frame as being about it; a reader who doesn't must learn its specific points.`);
        p.push('');
      }
      // Skeleton for multi-frame — empirically claude --print returns 1 byte
      // without an example, ~10KB with one. Show the exact shape, even with
      // placeholder content; the model fills it in.
      p.push(`Skeleton (replace placeholders with the inputs above; expand styling per the chosen type / style):`);
      p.push('```json#content-graph');
      p.push(JSON.stringify({
        schemaVersion: 1,
        intent: 'explainer',
        synopsis: '<one-line description>',
        nodes: Array.from({ length: requestedFrames }, (_, i) => ({
          id: `frame_${i + 1}`,
          kind: i === 0 ? 'text' : i === requestedFrames - 1 ? 'entity' : (i % 2 ? 'data' : 'text'),
          durationSec: Math.max(2, Math.floor(Number(collected.duration ?? '15') / requestedFrames)),
        })),
        edges: Array.from({ length: requestedFrames - 1 }, (_, i) => ({
          from: `frame_${i + 1}`,
          to: `frame_${i + 2}`,
          kind: 'sequence',
        })),
      }, null, 2));
      p.push('```');
      p.push('');
      p.push('```html#frame_1');
      p.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
      p.push('```');
      p.push('');
      p.push(`(continue with the same shape for the remaining frames — \`\`\`html#frame_2 … \`\`\`html#frame_${requestedFrames})`);
      if (baseHtml && baseHtml.length > 0) {
        p.push('');
        p.push(tmpl
          ? `Template HTML — this is the REQUIRED visual style. Reuse its palette, layout, typography, and animation approach; change only the text/data to fit the source material. Do NOT switch to a different look (no dark "cosmic particle" default, etc.):`
          : `Prior preview HTML to draw style from:`);
        p.push('```html');
        p.push(baseHtml.slice(0, 3000));
        p.push('```');
      }
    } else {
      p.push(`Output (single-frame): begin your reply with \`\`\`html and end with \`\`\`. Nothing outside the block.`);
      p.push('');
      if (baseHtml && baseHtml.length > 0) {
        p.push(tmpl
          ? `Template HTML — this is the REQUIRED visual style. Reuse its palette, layout, typography, and animation approach; change only the text/data to fit the source material. Do NOT switch to a different look:`
          : `Prior preview HTML (iterate on its visual style if it fits, or replace if a different vibe is better):`);
        p.push('```html');
        p.push(baseHtml.slice(0, 4000));
        p.push('```');
      } else {
        p.push(`Skeleton to extend (replace placeholder with the inputs above; expand styling per the chosen type / style):`);
        p.push('```html');
        p.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1.2s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
        p.push('```');
      }
    }
    p.push('');
    if (tmpl) {
      p.push(`Template visual signature (REQUIRED): ${tmpl.name} — ${tmpl.description}. Match this look — it is the whole reason the template was chosen. Only a single explicit user style note may override it; "based on this article" is NOT such an override.`);
      p.push('');
    }
    p.push(`Do NOT return an empty reply. Do NOT emit any of \`\`\`hv-options / \`\`\`hv-form / \`\`\`hv-confirm — those are over.`);
    // discard variable since some lints complain
    void w; void h;
    return p.join('\n');
  }

  // ---- iterate: post-generation free-form revision ----
  // claude --print is unreliable when fed 6KB+ of HTML and asked to emit
  // 6KB+ back — it silently no-ops in ~50% of attempts. Instead of feeding
  // the whole HTML, we extract the visible text + style summary and let
  // the model REWRITE rather than EDIT. Output is bounded by the same
  // skeleton trick used by generate-phase.
  const it: string[] = [];
  if (args.focusFrameId) {
    it.push(`The user has pinned frame "${args.focusFrameId}" and wants to revise ONLY that frame. Apply their request below — write a fresh complete HTML page that delivers the same content, in roughly the same visual style, but with the requested change.`);
  } else {
    it.push(`The user is iterating on an existing HTML video. Apply their request below — write a fresh complete HTML page that delivers the same content, in roughly the same visual style, but with the requested change.`);
  }
  it.push('');
  it.push(`# User request`);
  it.push(userText);
  it.push('');
  if (attachments.length > 0) {
    it.push(`# Attachments`);
    for (const a of attachments) it.push(...renderAttachment(a));
    it.push('');
  }
  if (baseHtml) {
    // IMPORTANT: do NOT inline the raw HTML. Empirically, including 6-8KB
    // of reference HTML in an iterate prompt makes `claude --print` return
    // 1 byte ~70% of the time (verified by hand). A summary of the
    // existing content + palette is enough to anchor a clean rewrite.
    const summary = summariseHtmlForIterate(baseHtml);
    it.push(`# Current frame — what's there now`);
    if (summary.headline) it.push(`Headline: ${summary.headline}`);
    if (summary.subheads.length) it.push(`Sub-text:\n${summary.subheads.map((s) => `  · ${s}`).join('\n')}`);
    if (summary.dataPoints.length) it.push(`Data points:\n${summary.dataPoints.map((s) => `  · ${s}`).join('\n')}`);
    if (summary.bgColors.length) it.push(`Palette: ${summary.bgColors.join(' / ')}`);
    if (summary.fontFamilies.length) it.push(`Fonts: ${summary.fontFamilies.join(', ')}`);
    it.push('');
  }
  it.push(`Output: ONE complete HTML document. Begin your reply with \`\`\`html and end with \`\`\`. Inline all CSS / JS. Full-bleed 1920×1080. Tag visible text with data-hv-text (preserve existing keys when meaningful). No prose outside the block. Do NOT return an empty reply.`);
  it.push('');
  it.push(`Skeleton to extend (replace with the real content + visual style):`);
  it.push('```html');
  it.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
  it.push('```');
  return it.join('\n');
}

/** Pull headline / subheads / data values / palette / fonts from a frame's HTML. */
function summariseHtmlForIterate(html: string): {
  headline: string;
  subheads: string[];
  dataPoints: string[];
  bgColors: string[];
  fontFamilies: string[];
} {
  const subheads: string[] = [];
  const dataPoints: string[] = [];
  // Visible text in tagged elements
  const textRe = /data-hv-text="([^"]+)"[^>]*>([^<]{1,160})</gi;
  let m: RegExpExecArray | null;
  let headline = '';
  while ((m = textRe.exec(html)) !== null) {
    const key = m[1] ?? '';
    const val = (m[2] ?? '').trim();
    if (!val) continue;
    if (/headline|title|hero/i.test(key) && !headline) headline = val;
    else if (/data|stat|value|number/i.test(key)) dataPoints.push(`${key}: ${val}`);
    else subheads.push(`${key}: ${val}`);
  }
  // Body / stage background colour (rough)
  const bgColors = Array.from(
    html.matchAll(/background[^:]*:\s*(#[0-9a-f]{3,8}|rgb[a]?\([^)]+\)|hsla?\([^)]+\))/gi),
  ).slice(0, 3).map((x) => x[1]!).filter(Boolean);
  // Font families (first occurrence in css)
  const fontFamilies = Array.from(
    new Set(
      Array.from(html.matchAll(/font-family\s*:\s*([^;}]+)/gi))
        .map((x) => (x[1] ?? '').trim().slice(0, 80))
        .filter(Boolean),
    ),
  ).slice(0, 2);
  return {
    headline,
    subheads: subheads.slice(0, 6),
    dataPoints: dataPoints.slice(0, 6),
    bgColors,
    fontFamilies,
  };
}

/**
 * Extract a full HTML document from agent output.
 * Tries (1) `\`\`\`html ... \`\`\`` block, (2) bare `<!doctype html>...</html>`.
 */
function extractHtmlDocument(text: string): string | null {
  // Plain ```html``` block (no node-id tag — single-frame fast path)
  const fence = /```html\s*\n([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) {
    const html = fence[1].trim();
    if (/<\/html>/i.test(html)) return html;
  }
  const bare = /<!doctype html[\s\S]*?<\/html>/i.exec(text);
  if (bare) return bare[0];
  return null;
}

/**
 * v0.8: extract a content-graph JSON block + N tagged html#<nodeId> blocks
 * from a single agent response.
 *
 * Expected agent output format for multi-frame:
 *   ```json#content-graph
 *   { "schemaVersion": 1, "intent": "explainer", "nodes": [...], "edges": [...] }
 *   ```
 *   ```html#node_1
 *   <!doctype html>...
 *   ```
 *   ```html#node_2
 *   <!doctype html>...
 *   ```
 *
 * Returns null when no content-graph block is found (caller falls back to
 * single-frame extraction).
 */
function extractContentGraphAndFrames(
  text: string,
): { graph: import('@html-video/content-graph').ContentGraph; frames: { nodeId: string; html: string }[] } | null {
  // Find a fenced JSON block tagged as content-graph.
  const graphMatch = /```json#content-graph\s*\n([\s\S]*?)```/i.exec(text);
  if (!graphMatch || !graphMatch[1]) return null;
  let graph: import('@html-video/content-graph').ContentGraph;
  try {
    graph = parseGraphJsonTolerant(graphMatch[1].trim()) as import('@html-video/content-graph').ContentGraph;
  } catch {
    return null;
  }
  if (!graph || !Array.isArray((graph as { nodes?: unknown[] }).nodes)) return null;

  // Find tagged html blocks: ```html#<nodeId>
  const frames: { nodeId: string; html: string }[] = [];
  const re = /```html#([a-z0-9_-]+)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const nodeId = match[1];
    const html = match[2]?.trim() ?? '';
    if (nodeId && /<\/html>/i.test(html)) {
      frames.push({ nodeId, html });
    }
  }

  return { graph, frames };
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
  const { ctx, projectId, projectDir, agentDef, agentModel, tmpl, priorHtml, inputs, attachments, openingTopic, restyleOnly, onProgress, onSse } = args;
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
    } catch { /* fall back to description-only */ }
  }
  const aspect = ((collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9');
  const frameCountReq = Math.max(2, Math.min(10, Number(collected.frame_count ?? '4') || 4));
  // Opt-in (format card): render data frames natively with Remotion. When on,
  // the planner must give every data node structured items, and after each
  // data frame's HTML is written we enhance it in place (best-effort).
  const enhanceData = (collected.remotion_enhance ?? '').startsWith('开');
  // Prefer per-frame pacing (total = per_frame × frames) — set by the format
  // card so a short total ÷ many frames can't produce a rushed clip. Fall back
  // to total ÷ frames for older projects that only stored `duration`.
  const perFrameInput = Number(collected.per_frame ?? '') || 0;
  const perFrameDurationSec = perFrameInput > 0
    ? Math.max(2, perFrameInput)
    : Math.max(2, Math.floor((Number(collected.duration ?? '15') || 15) / frameCountReq));
  const totalDurationSec = perFrameInput > 0
    ? perFrameDurationSec * frameCountReq
    : (Number(collected.duration ?? '15') || 15);
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

  const styleLabel = pickedStyle && /^从设计模板选|template/i.test(pickedStyle)
    ? (tmpl ? `(use the selected template "${tmpl.name}" — ${tmpl.description})` : '(let the model choose)')
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
  graphPromptParts.push(`Plan a ${frameCountReq}-frame HTML video storyboard. Output ONLY a content-graph JSON in a fenced \`\`\`json#content-graph block — no HTML, no prose outside.`);
  graphPromptParts.push('');
  graphPromptParts.push(`Inputs (use literally — do NOT invent brand names or facts beyond these):`);
  graphPromptParts.push(`- 类型 / type: ${pickedType || '(unspecified)'} (this is the FORMAT, NOT the subject — never make the video be "about" the type itself)`);
  // Lock the storyboard to the user's opening subject (unless a SOURCE MATERIAL
  // block below supersedes it). This is the path the user actually hits, and
  // where "随机" turned into a randomness explainer instead of the Open Design
  // promo they asked for.
  if (openingTopic && !attachments.some((a) => !!a.inlineText)) {
    graphPromptParts.push(`- 主题 / subject (LOCKED): the user opened with "${openingTopic}". The synopsis and EVERY node MUST be about this subject. If the content line below is a vague word like "随机 / 随便 / anything / 你定", it means "you choose the concrete angle and points — but keep the subject = "${openingTopic}"". NEVER make the video about randomness or the literal word.`);
  }
  if (contentTurns.length > 0) {
    graphPromptParts.push(`- 内容 / content:`);
    for (const t of contentTurns) graphPromptParts.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
  }
  // Inline the fetched article / repo / uploaded text — THIS is the subject of
  // the video. Without it the planner only sees the type word and invents a
  // video "about 概念解说" instead of about the user's actual source.
  const { specs: designSpecs, content: contentAtts } = partitionAttachments(attachments);
  if (designSpecs.length > 0) graphPromptParts.push('', ...renderDesignSpecBlock(designSpecs));
  const sourceTexts = contentAtts.filter((a) => !!a.inlineText);
  if (sourceTexts.length > 0) {
    graphPromptParts.push('');
    graphPromptParts.push(`SOURCE MATERIAL — the video MUST be about THIS content (real facts, names, numbers from it). This is the subject, not the type:`);
    for (const a of sourceTexts) {
      graphPromptParts.push(`--- ${a.filename} ---`);
      graphPromptParts.push((a.inlineText ?? '').slice(0, 6000));
    }
  }
  if (styleLabel) graphPromptParts.push(`- 风格 / style: ${styleLabel}`);
  graphPromptParts.push(`- 总时长: ${totalDurationSec}s split across ${frameCountReq} frames (~${perFrameDurationSec}s each)`);
  graphPromptParts.push('');
  if (sourceTexts.length > 0) {
    graphPromptParts.push(`GROUNDING (REQUIRED): every node's text must come from the SOURCE MATERIAL above — quote its real product names, facts, numbers. The synopsis must name the source's actual subject. BANNED: generic filler about the content TYPE (e.g. "什么是概念解说", "信息密度×传播效率") that would fit any video. If a line could fit any topic, it's wrong.`);
    graphPromptParts.push('');
  }
  graphPromptParts.push(`Schema (keep all keys; one node per frame; nodes[].id should be a short readable slug like "intro" / "stat_users" / "outro"):`);
  graphPromptParts.push('```json#content-graph');
  graphPromptParts.push(JSON.stringify({
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
  }, null, 2));
  graphPromptParts.push('```');
  graphPromptParts.push('');
  graphPromptParts.push(`Replace the placeholder text in each node with concrete content from the inputs. Adjust intent to match (single-frame|explainer|data-viz|promo|comparison|other). Keep node ids unique. Do NOT return an empty reply. Do NOT emit any HTML this turn.`);
  graphPromptParts.push(`DATA FRAMES: every \`kind:"data"\` node MUST carry a \`data\` object \`{ title?, unit?, items: [{ label, value }] }\` with at least 2 items and numeric \`value\`s drawn from the inputs/source — real figures, not placeholders (they can be animated with rolling counters / growing bars). The node's \`text\` still holds the headline. If a frame genuinely has no quantitative data, make it a \`text\` node instead of \`data\`.`);
  graphPromptParts.push(`DATA FRAME QUALITY: (1) Items in ONE data frame must be COMPARABLE — the same unit and a similar order of magnitude. Do NOT mix wildly different scales in one chart (e.g. 61,000 GitHub stars next to 142 plugins) — one giant bar makes the rest invisible. If figures have different units or scales, split them across separate data frames, or pick the 2-4 that genuinely compare. (2) \`unit\` is OPTIONAL and only for a real shared unit (e.g. "%", "K", "★", "ms"). If the numbers are plain counts with no meaningful unit, OMIT \`unit\` entirely — never use filler like "count" / "个" / "次".`);
  graphPromptParts.push(`STRICT JSON: the block must be valid JSON. Inside string values do NOT use straight double-quotes ("…") — if you need to quote a term or title, use 「」 or 《》 or single quotes. No trailing commas. No comments.`);

  const graphPrompt = graphPromptParts.join('\n');
  const graphText = await callAgentSimple(agentDef, graphPrompt, projectDir, agentModel);
  const graphMatch = /```json#content-graph\s*\n([\s\S]*?)```/i.exec(graphText)
    ?? /```json\s*\n([\s\S]*?)```/i.exec(graphText);
  if (!graphMatch || !graphMatch[1]) {
    throw new Error(`agent did not return a content-graph (got ${graphText.length} bytes, head: ${graphText.slice(0, 80)})`);
  }
  try {
    graph = parseGraphJsonTolerant(graphMatch[1].trim()) as import('@html-video/content-graph').ContentGraph;
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
    fp.push(`Generate ONE complete HTML page for frame "${nodeId}" of a ${graph.nodes.length}-frame video. Output ONE \`\`\`html block, nothing else.`);
    fp.push('');
    fp.push(`Frame ${i + 1} of ${graph.nodes.length}: ${frameContext}`);
    if (restyleOnly) {
      // Keep the exact words; only the visual style changes.
      fp.push(`RESTYLE: keep this frame's TEXT EXACTLY as given above — same headline, subtitle, numbers, wording. Do NOT rewrite, translate, or reword anything. Change ONLY the visual style (layout, colour, typography, motion) to: ${styleLabel || pickedStyle || '(the new style)'}.`);
    }
    if (openingTopic && !attachments.some((a) => !!a.inlineText)) {
      fp.push(`Subject (locked): "${openingTopic}". This frame is about this subject; "随机/随便" anywhere in the inputs means you pick details, not a new topic.`);
    }
    fp.push(`Duration: ${node.durationSec ?? perFrameDurationSec}s`);
    fp.push(`Type: ${pickedType}`);
    if (styleLabel) fp.push(`Style: ${styleLabel}`);
    fp.push(`Resolution: ${aspect} (${resolution})`);
    fp.push('');
    if (contentTurns.length > 0) {
      fp.push(`Source material from the user (use literally; do NOT invent facts):`);
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
      fp.push(`SOURCE MATERIAL (the video's real subject — use its actual facts/names/numbers, never generic filler about the content type):`);
      for (const a of frameSourceTexts) fp.push((a.inlineText ?? '').slice(0, 3000));
      fp.push('');
    }
    fp.push(`Output: begin with \`\`\`html and end with \`\`\`. Inline CSS + JS, full-bleed ${resolution}, opens with an animation timeline. Tag visible text with data-hv-text. CDN imports (Tailwind, GSAP) fine. No prose outside the block.`);
    fp.push('');
    if (templateHtml) {
      // A template is selected → its HTML is the REQUIRED look for every frame.
      fp.push(`Template HTML — this is the REQUIRED visual style for THIS frame. Reuse its exact palette, background, typography, layout structure and animation approach; only swap in this frame's text/data. Do NOT invent a different theme (no generic dark background unless the template itself is dark):`);
      fp.push('```html');
      fp.push(templateHtml.slice(0, 4000));
      fp.push('```');
      fp.push('');
      fp.push(`Keep all ${graph.nodes.length} frames visually consistent with this template so they read as one video.`);
    } else {
      fp.push(`Skeleton to extend (replace placeholder, expand styling per type / style):`);
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
        fp.push(`Visual style reference (mine for palette / typography / motion vocabulary, do not copy literally):`);
        fp.push('```html');
        fp.push(priorHtml.slice(0, 2400));
        fp.push('```');
      }
    }
    if (i === 0 && attachments.length > 0) {
      fp.push('');
      fp.push(`User attachments (binary = assets; inlined text = source material to base content on):`);
      for (const a of attachments) fp.push(...renderAttachment(a));
    }
    fp.push('');
    fp.push(`Do NOT return an empty reply. Output the full HTML.`);

    const framePrompt = fp.join('\n');
    let frameText = await callAgentSimple(agentDef, framePrompt, projectDir, agentModel);
    let extracted = /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim()
      ?? /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];

    // One retry on empty: shorter prompt, just the skeleton call.
    if (!extracted) {
      onProgress(`  ↻ 第 ${i + 1} 帧首试为空，重试…`);
      const retryPrompt = `Output ONE complete HTML video frame in a fenced \`\`\`html block. Frame purpose: ${frameContext}. Style: ${styleLabel || 'tasteful default'}. Resolution: ${resolution}. ${contentTurns.length ? `Content: ${contentTurns.join(' / ').slice(0, 200)}` : ''} \n\nBegin your reply with \`\`\`html. Inline CSS, opens with animation, tag text with data-hv-text. No prose.`;
      frameText = await callAgentSimple(agentDef, retryPrompt, projectDir, agentModel);
      extracted = /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim()
        ?? /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];
    }
    if (!extracted) {
      throw new Error(`frame "${nodeId}" generation returned empty (${frameText.length}B)`);
    }
    await ctx.orchestrator.writeFrameHtml(projectId, nodeId, extracted);
    // Native Remotion enhancement (opt-in via format card). The frame now has a
    // FrameRecord, so enhanceFrameNative can set engine/nativeTemplateId/data in
    // place. Best-effort: if the data node lacks usable {label,value} items it
    // throws — we keep the hyperframes HTML and warn rather than fail the run.
    // 'frame-data-rollup' is the only native template today (TODO: picker).
    if (enhanceData && node.kind === 'data') {
      try {
        // Two steps, same as the manual enhance endpoint: (1) set the frame's
        // engine/data, (2) actually RENDER the preview MP4. Without step 2 the
        // frame is flagged remotion but has no previewMp4Path, so the studio
        // tries to play a <video> that 404s → black thumbnail + preview.
        await ctx.orchestrator.enhanceFrameNative(projectId, nodeId, 'frame-data-rollup');
        onProgress(`  ⚡ 第 ${i + 1} 帧渲染 Remotion 动效 (数字滚动 / 柱子生长)…`);
        await ctx.orchestrator.renderFrameNativePreview({ projectId, graphNodeId: nodeId });
        onSse({ type: 'frame_enhanced', node_id: nodeId, order: i });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[studio:split-generate] proj=${projectId} frame=${nodeId} enhance skipped: ${msg}\n`);
        onProgress(`  ⚠️ 第 ${i + 1} 帧无法用 Remotion 增强（回落静态 HTML）：${msg}`);
        // Revert the engine flag so the frame falls back to its hyperframes HTML
        // (the <iframe> path) instead of showing a broken <video>.
        try { await ctx.orchestrator.unenhanceFrame(projectId, nodeId); } catch { /* ignore */ }
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
  if ((node as { text?: string }).text) bits.push(`text: ${(node as { text: string }).text.slice(0, 200)}`);
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
