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
import { AssetStore } from '@html-video/core';
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
          templates: ctx.templates.list().map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            engine: t.engine,
            category: t.category,
            tags: t.tags,
            best_for: t.best_for,
            inputs_schema: t.inputs.schema,
            inputs_examples: t.inputs.examples,
            license: t.license,
            preview: t.preview,
            output: t.output,
          })),
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

      // Export MP4
      const expMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
      if (expMatch && expMatch[1] && m === 'POST') {
        const { project, outputPath } = await ctx.orchestrator.exportMp4({
          projectId: expMatch[1],
        });
        return json(res, 200, { project, output_path: outputPath });
      }

      // Agents (detected on each call; cheap)
      if (url.pathname === '/api/agents' && m === 'GET') {
        const agents = await detectAll();
        return json(res, 200, { agents });
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
                attachments.push({
                  path: newAsset.path ?? p.tmpPath,
                  kind: newAsset.type as Attachment['kind'],
                  filename: p.filename,
                  size: newAsset.metadata.sizeBytes ?? 0,
                });
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

        // Re-fetch project after potential addFileAsset side-effects
        const project = await ctx.orchestrator.load(id);
        const tmpl = project.templateId ? ctx.templates.get(project.templateId) : null;
        // No template required — agent can synthesize from scratch when none picked.

        // Default to anthropic-api (HTTP) when nothing's pinned — talking to
        // the Messages API directly avoids the `claude --print` 1-byte
        // empty-reply failure mode on long creative outputs. claude CLI is
        // still selectable if the user prefers it.
        const agentId = project.agentId ?? 'anthropic-api';
        const agentDef = findAgent(agentId);
        if (!agentDef) {
          return json(res, 400, { error: `agent "${agentId}" not registered` });
        }

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

        const fullPrompt = buildHtmlGenerationPrompt({
          tmpl,
          exampleHtml,
          priorHtml,
          history,
          userText,
          attachments,
          focusFrameId: focusFrameId || undefined,
        });
        const phaseInfo = detectPhase(history, userText, !!project.templateId);
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

        // SSE response
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });

        const sseWrite = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

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

        if (isMultiGenerate) {
          try {
            const result = await runSplitMultiFrameGenerate({
              ctx,
              projectId: id,
              projectDir,
              agentDef,
              tmpl,
              priorHtml,
              inputs: phaseInfo.inputs,
              attachments,
              onProgress: (msg) => {
                assistantText += msg + '\n';
                textChunks += 1;
                sseWrite({ type: 'text', chunk: msg + '\n' });
              },
              onSse: sseWrite,
            });
            summaryLine = `✓ ${result.frameCount}-frame storyboard generated (intent: ${result.intent})`;
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
            context: { cwd: projectDir },
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
          res.write(`data: ${JSON.stringify({ type: 'text', chunk: fallback })}\n\n`);
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
      }

      // ============== v0.8: content-graph + frames API ==============

      // GET content graph as JSON
      const cgMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/content-graph$/);
      if (cgMatch && cgMatch[1] && m === 'GET') {
        const graph = await ctx.orchestrator.readContentGraph(cgMatch[1]);
        if (!graph) return json(res, 404, { error: 'No content graph for this project' });
        return json(res, 200, { graph });
      }

      // ============== File serving ==============

      // Project preview HTML (and any sibling files like assets/)
      const previewServeMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (previewServeMatch && previewServeMatch[1]) {
        const projId = previewServeMatch[1];
        const sub = previewServeMatch[2] ?? '/preview.html';
        const project = await ctx.orchestrator.load(projId);

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
        const filePath = join(t.__dir!, tplAssetMatch[2]);
        if (existsSync(filePath)) return serveFile(filePath, res);
        res.writeHead(404);
        return res.end();
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
    const fnMatch = headers.match(/filename="([^"]+)"/);
    if (fnMatch && fnMatch[1]) {
      const filename = fnMatch[1];
      const tmpPath = join(tmpdir(), `hv-upload-${randomUUID().slice(0, 8)}-${filename}`);
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
  | 'format'
  | 'format-edit'
  | 'confirm'
  | 'generate'
  | 'iterate';

interface PhaseInputs {
  collected?: Record<string, string>; // last submitted hv-form values (format only)
  pickedType?: string;
  pickedStyle?: string;
  contentTurns?: string[];            // free-text user messages between type-pick and style/format
}

function detectPhase(
  history: ChatMessage[],
  userText: string,
  hasTemplate: boolean,
): { phase: ConvPhase; inputs: PhaseInputs } {
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

  // Has any successful generation already happened? Then this is iteration.
  const hadGeneration = history.some(
    (m) => m.role === 'assistant' && /```html|```json#content-graph|✓\s/i.test(m.content),
  );
  if (hadGeneration) {
    return { phase: 'iterate', inputs: { collected: lastFormSubmission(history) } };
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
    return { phase: 'content', inputs };
  }

  // Last card was a style-pick → user answered with style choice.
  if (prev.kind === 'hv-options' && prev.metaPhase === 'style') {
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.pickedStyle = trimmed;
    inputs.contentTurns = collectContentTurns(history);
    return { phase: 'format', inputs };
  }

  // Last card was content-question (a plain assistant message asking for content).
  // We detect this by phase metadata in a hidden HTML comment we embed.
  if (prev.kind === 'content-question') {
    // User is replying to content question. Could be (a) more content, or
    // (b) a "skip / I'm done" signal.
    const isSkip = /^(skip|跳过|够了|够|done|next|下一步|ok|好|不知道)$/i.test(trimmed)
      || trimmed.length <= 3;
    if (isSkip || hasEnoughContent(history, trimmed)) {
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

function buildHtmlGenerationPrompt(args: BuildPromptArgs): string {
  const { tmpl, exampleHtml, priorHtml, history, userText, attachments } = args;

  const baseHtml = priorHtml && priorHtml !== exampleHtml ? priorHtml : exampleHtml;
  const trimmed = userText.trim();
  const { phase, inputs } = detectPhase(history, userText, !!tmpl);

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
    p.push(`The user is making a ${pickedType ? `"${pickedType}"` : 'video'}. Collect concrete content for it via natural conversation — DO NOT emit any code block, hv-options, hv-form, or hv-confirm. End your reply with this hidden marker on its own line so the server knows you're still in the content phase:`);
    p.push('<!-- hv-phase:content-question -->');
    p.push('');
    p.push(`Goal: surface what the video is ABOUT (topic, brand / project name, headline / tagline, key numbers or data points). The user can answer, partially answer, or say "随便发挥 / skip / 不知道" — accept whatever they give and move on.`);
    p.push('');
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

  // ---- format / format-edit: hv-form with 3 segmented controls ----
  if (phase === 'format' || phase === 'format-edit') {
    const isEdit = phase === 'format-edit';
    const pre = inputs.collected ?? {};
    const pickedType = isEdit
      ? lastCardPickByPhase(history, 'type') ?? ''
      : (inputs.pickedType ?? '');
    const isMulti = !!pickedType && /多帧|预告|时间线|对比|讲解|teaser|explainer|comparison|timeline/i.test(pickedType);
    const defaults = {
      aspect:      pre.aspect      ?? '16:9 横屏',
      duration:    pre.duration    ?? (isMulti ? '15' : '5'),
      frame_count: pre.frame_count ?? (isMulti ? '4' : '1'),
    };
    const p: string[] = [];
    if (isEdit) {
      p.push(`The user wants to revise the format. Re-emit the SAME hv-form card with each \`default\` set to their last answer so they only need to change what they want.`);
    } else {
      p.push(`Now ask about format with ONE hv-form card — three segmented controls, no text inputs. JSON shape EXACTLY as shown — keep "meta" verbatim:`);
    }
    p.push('```hv-form');
    p.push(JSON.stringify({
      meta: { phase: 'format' },
      title: isEdit ? '改一下格式' : '最后一步：选个尺寸 / 时长 / 帧数',
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
        {
          key: 'duration', label: '时长 (秒)', kind: 'buttons', required: true,
          default: defaults.duration,
          options: ['3', '5', '10', '15', '30'].map((v) => ({ value: v, label: `${v}s` })),
        },
        {
          key: 'frame_count', label: '帧数', kind: 'buttons', required: true,
          default: defaults.frame_count,
          options: ['1', '2', '3', '4', '5', '6'].map((v) => ({ value: v, label: v })),
        },
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
      aspect: '尺寸', duration: '时长', frame_count: '帧数',
    };
    for (const k of ['aspect', 'duration', 'frame_count']) {
      const v = collected[k];
      if (v) summaryRows.push({ label: labelMap[k] ?? k, value: v });
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
    const isMulti = /多帧|预告|时间线|对比|讲解|teaser|explainer|comparison|timeline/i.test(pickedType)
      || Number(collected.frame_count ?? '1') > 1;

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
      p.push(`Attachments:`);
      for (const a of attachments) p.push(`- [${a.kind}] ${a.filename} — ${a.path}`);
      p.push(`Use these as actual assets where appropriate (logo, screenshot, data file).`);
      p.push('');
    }
    p.push(`Constraints: full-bleed ${resolution}, opens with an animation timeline, inline CSS + JS, single complete <!doctype html>...</html> document(s). CDN imports (Tailwind, GSAP) are fine. Tag every visible text node with data-hv-text set to a stable key (brand_name, headline, item_1, cta…). No prose outside code blocks.`);
    p.push('');
    // Frame-count safety: claude --print starts truncating / stalling around
    // 8+ frames worth of HTML. Cap multi-frame generation to 6, tell the
    // model so it can plan accordingly.
    const requestedFrames = Math.max(1, Math.min(6, Number(collected.frame_count ?? '4') || 4));
    if (isMulti) {
      p.push(`Output (multi-frame storyboard) — emit IN THIS EXACT ORDER and SHAPE:`);
      p.push(`1. ONE \`\`\`json#content-graph block.`);
      p.push(`2. ONE \`\`\`html#<nodeId> block per node.`);
      p.push('');
      p.push(`Aim for ${requestedFrames} frames. Each frame should be self-contained, full-bleed ${resolution}, with its own opening animation. Nothing between blocks.`);
      p.push('');
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
        p.push(`Prior preview HTML to draw style from:`);
        p.push('```html');
        p.push(baseHtml.slice(0, 3000));
        p.push('```');
      }
    } else {
      p.push(`Output (single-frame): begin your reply with \`\`\`html and end with \`\`\`. Nothing outside the block.`);
      p.push('');
      if (baseHtml && baseHtml.length > 0) {
        p.push(`Prior preview HTML (iterate on its visual style if it fits, or replace if a different vibe is better):`);
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
      p.push(`Template visual signature: ${tmpl.name} — ${tmpl.description}. Honour it unless the user's style note overrides.`);
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
    for (const a of attachments) it.push(`- [${a.kind}] ${a.filename} — ${a.path}`);
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
    graph = JSON.parse(graphMatch[1].trim()) as import('@html-video/content-graph').ContentGraph;
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
  tmpl: import('@html-video/core').TemplateMetadata | null;
  priorHtml: string;
  inputs: PhaseInputs;
  attachments: Attachment[];
  /** Called for human-readable progress lines. */
  onProgress: (msg: string) => void;
  /** Called for structured SSE events. */
  onSse: (obj: unknown) => void;
}

async function runSplitMultiFrameGenerate(
  args: SplitGenerateArgs,
): Promise<{ frameCount: number; intent: string }> {
  const { ctx, projectId, projectDir, agentDef, tmpl, priorHtml, inputs, attachments, onProgress, onSse } = args;
  const collected = inputs.collected ?? {};
  const pickedType = inputs.pickedType ?? '';
  const pickedStyle = inputs.pickedStyle ?? '';
  const contentTurns = inputs.contentTurns ?? [];
  const aspect = ((collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9');
  const frameCountReq = Math.max(2, Math.min(6, Number(collected.frame_count ?? '4') || 4));
  const totalDurationSec = Number(collected.duration ?? '15') || 15;
  const perFrameDurationSec = Math.max(2, Math.floor(totalDurationSec / frameCountReq));
  let resolution = '1920×1080';
  if (aspect === '9:16') resolution = '1080×1920';
  else if (aspect === '1:1') resolution = '1080×1080';
  else if (aspect === '4:5') resolution = '1080×1350';

  const styleLabel = pickedStyle && /^从设计模板选|template/i.test(pickedStyle)
    ? (tmpl ? `(use the selected template "${tmpl.name}" — ${tmpl.description})` : '(let the model choose)')
    : pickedStyle;

  // ---- Step 1: ask for the content graph only ----
  onProgress(`📋 规划 ${frameCountReq} 帧的故事板…`);
  const graphPromptParts: string[] = [];
  graphPromptParts.push(`Plan a ${frameCountReq}-frame HTML video storyboard. Output ONLY a content-graph JSON in a fenced \`\`\`json#content-graph block — no HTML, no prose outside.`);
  graphPromptParts.push('');
  graphPromptParts.push(`Inputs (use literally — do NOT invent brand names or facts beyond these):`);
  graphPromptParts.push(`- 类型 / type: ${pickedType || '(unspecified)'}`);
  if (contentTurns.length > 0) {
    graphPromptParts.push(`- 内容 / content:`);
    for (const t of contentTurns) graphPromptParts.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
  }
  if (styleLabel) graphPromptParts.push(`- 风格 / style: ${styleLabel}`);
  graphPromptParts.push(`- 总时长: ${totalDurationSec}s split across ${frameCountReq} frames (~${perFrameDurationSec}s each)`);
  graphPromptParts.push('');
  graphPromptParts.push(`Schema (keep all keys; one node per frame; nodes[].id should be a short readable slug like "intro" / "stat_users" / "outro"):`);
  graphPromptParts.push('```json#content-graph');
  graphPromptParts.push(JSON.stringify({
    schemaVersion: 1,
    intent: 'explainer',
    synopsis: '<one-line description of the video>',
    nodes: Array.from({ length: frameCountReq }, (_, i) => ({
      id: `frame_${i + 1}`,
      kind: i === 0 ? 'text' : i === frameCountReq - 1 ? 'entity' : 'data',
      durationSec: perFrameDurationSec,
      text: '<headline / subtitle for this frame>',
    })),
    edges: Array.from({ length: frameCountReq - 1 }, (_, i) => ({
      from: `frame_${i + 1}`,
      to: `frame_${i + 2}`,
      kind: 'sequence',
    })),
  }, null, 2));
  graphPromptParts.push('```');
  graphPromptParts.push('');
  graphPromptParts.push(`Replace the placeholder text in each node with concrete content from the inputs. Adjust intent to match (single-frame|explainer|data-viz|promo|comparison|other). Keep node ids unique. Do NOT return an empty reply. Do NOT emit any HTML this turn.`);

  const graphPrompt = graphPromptParts.join('\n');
  const graphText = await callAgentSimple(agentDef, graphPrompt, projectDir);
  const graphMatch = /```json#content-graph\s*\n([\s\S]*?)```/i.exec(graphText)
    ?? /```json\s*\n([\s\S]*?)```/i.exec(graphText);
  if (!graphMatch || !graphMatch[1]) {
    throw new Error(`agent did not return a content-graph (got ${graphText.length} bytes, head: ${graphText.slice(0, 80)})`);
  }
  let graph: import('@html-video/content-graph').ContentGraph;
  try {
    graph = JSON.parse(graphMatch[1].trim()) as import('@html-video/content-graph').ContentGraph;
  } catch (e) {
    throw new Error(`graph JSON failed to parse: ${e instanceof Error ? e.message : e}`);
  }
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error('graph has no nodes');
  }
  await ctx.orchestrator.writeContentGraph(projectId, graph);
  onProgress(`✓ 故事板规划完成：${graph.nodes.length} 帧 (${graph.intent})`);
  onSse({ type: 'plan_ready', frame_count: graph.nodes.length, intent: graph.intent });

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
    fp.push(`Output: begin with \`\`\`html and end with \`\`\`. Inline CSS + JS, full-bleed ${resolution}, opens with an animation timeline. Tag visible text with data-hv-text. CDN imports (Tailwind, GSAP) fine. No prose outside the block.`);
    fp.push('');
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
    if (i === 0 && attachments.length > 0) {
      fp.push('');
      fp.push(`User attachments (use as actual assets if the frame can use them):`);
      for (const a of attachments) fp.push(`- [${a.kind}] ${a.filename} — ${a.path}`);
    }
    fp.push('');
    fp.push(`Do NOT return an empty reply. Output the full HTML.`);

    const framePrompt = fp.join('\n');
    let frameText = await callAgentSimple(agentDef, framePrompt, projectDir);
    let extracted = /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim()
      ?? /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];

    // One retry on empty: shorter prompt, just the skeleton call.
    if (!extracted) {
      onProgress(`  ↻ 第 ${i + 1} 帧首试为空，重试…`);
      const retryPrompt = `Output ONE complete HTML video frame in a fenced \`\`\`html block. Frame purpose: ${frameContext}. Style: ${styleLabel || 'tasteful default'}. Resolution: ${resolution}. ${contentTurns.length ? `Content: ${contentTurns.join(' / ').slice(0, 200)}` : ''} \n\nBegin your reply with \`\`\`html. Inline CSS, opens with animation, tag text with data-hv-text. No prose.`;
      frameText = await callAgentSimple(agentDef, retryPrompt, projectDir);
      extracted = /```html\s*\n([\s\S]*?)```/i.exec(frameText)?.[1]?.trim()
        ?? /<!doctype html[\s\S]*?<\/html>/i.exec(frameText)?.[0];
    }
    if (!extracted) {
      throw new Error(`frame "${nodeId}" generation returned empty (${frameText.length}B)`);
    }
    await ctx.orchestrator.writeFrameHtml(projectId, nodeId, extracted);
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
): Promise<string> {
  let buf = '';
  const handle = spawnAgent({
    def,
    prompt,
    context: { cwd },
    onEvent: (ev) => {
      if (ev.type === 'text') buf += ev.chunk;
    },
  });
  await handle.done;
  return buf;
}
