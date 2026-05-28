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
        const attachments: Attachment[] = [];

        const project0 = await ctx.orchestrator.load(id);
        if (ct.startsWith('multipart/form-data')) {
          const parts = await receiveMultipart(req, ct);
          for (const p of parts) {
            if (p.kind === 'field' && p.name === 'content') {
              userText = p.value;
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
        }

        if (!userText && attachments.length === 0) {
          return json(res, 400, { error: 'content or attachments required' });
        }

        // Re-fetch project after potential addFileAsset side-effects
        const project = await ctx.orchestrator.load(id);
        const tmpl = project.templateId ? ctx.templates.get(project.templateId) : null;
        // No template required — agent can synthesize from scratch when none picked.

        const agentId = project.agentId ?? 'claude';
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
        const priorHtmlPath = join(projectDir, 'preview.html');
        const priorHtml = existsSync(priorHtmlPath)
          ? await readFile(priorHtmlPath, 'utf8')
          : '';
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
        });

        // SSE response
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });

        let assistantText = '';
        const handle = spawnAgent({
          def: agentDef,
          prompt: fullPrompt,
          context: { cwd: projectDir },
          onEvent: (ev) => {
            if (ev.type === 'text') {
              assistantText += ev.chunk;
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } else if (ev.type === 'error' || ev.type === 'message_end') {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            }
          },
        });
        await handle.done;

        // v0.8: try multi-frame path first — content-graph JSON + tagged html blocks.
        // Fall back to single-frame fast path (v0.7) when no graph is emitted.
        const multi = extractContentGraphAndFrames(assistantText);
        let summaryLine = '';
        if (multi && multi.frames.length > 0) {
          await ctx.orchestrator.writeContentGraph(id, multi.graph);
          for (const f of multi.frames) {
            try {
              await ctx.orchestrator.writeFrameHtml(id, f.nodeId, f.html);
            } catch (err) {
              // Don't abort the whole turn for one bad frame; surface a hint.
              const msg = err instanceof Error ? err.message : String(err);
              res.write(
                `data: ${JSON.stringify({ type: 'text', chunk: `\n[frame ${f.nodeId} skipped: ${msg}]\n` })}\n\n`,
              );
            }
          }
          res.write(
            `data: ${JSON.stringify({ type: 'preview_ready', preview_url: `/preview/${id}`, frames: multi.frames.length })}\n\n`,
          );
          summaryLine = `✓ ${multi.frames.length}-frame storyboard generated (intent: ${multi.graph.intent})`;
        } else {
          // Single-frame fast path: extract one HTML doc, write preview.
          const extracted = extractHtmlDocument(assistantText);
          if (extracted) {
            await ctx.orchestrator.writePreviewHtmlRaw(id, extracted);
            res.write(
              `data: ${JSON.stringify({ type: 'preview_ready', preview_url: `/preview/${id}` })}\n\n`,
            );
            summaryLine = '✓ updated the HTML preview';
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
 * Recognise which phase the conversation is in so we can hand the agent a
 * single, narrow prompt. State machine (see RFC-07 — flow chart):
 *
 *   opener    → first short / vague user message; expect hv-options card
 *               for content-type pick
 *   info      → user picked an option → expect hv-form to collect
 *               brand / headline / data / aspect / duration / frame_count / style
 *   confirm   → user submitted hv-form ([hv-form:submit]\n<json>) →
 *               expect hv-confirm card
 *   generate  → user clicked "✓ 开始生成" ([hv-confirm:generate]) →
 *               this is the only turn that may emit HTML / content-graph
 *   info-edit → user clicked "✏️ 修改" ([hv-confirm:edit]) →
 *               re-emit hv-form with `default` values prefilled
 *   iterate   → after a successful generate, the user free-forms more
 *               revisions on the rendered HTML (the v0.7 path)
 */
type ConvPhase = 'opener' | 'info' | 'info-edit' | 'confirm' | 'generate' | 'iterate';

interface PhaseInputs {
  collected?: Record<string, string>; // last submitted hv-form values
  pickedType?: string;                // label from the opener hv-options card
}

function detectPhase(history: ChatMessage[], userText: string): { phase: ConvPhase; inputs: PhaseInputs } {
  const trimmed = userText.trim();
  const inputs: PhaseInputs = {};

  // Look at the latest meaningful exchange. A user turn can be one of:
  //   "[hv-form:submit]\n<json>"   → previous card was hv-form, now confirm
  //   "[hv-confirm:generate]"      → run the generator
  //   "[hv-confirm:edit]"          → re-show the form, pre-filled
  //   anything else                → pick by previous assistant card kind
  if (trimmed.startsWith('[hv-form:submit]')) {
    const body = trimmed.slice('[hv-form:submit]'.length).trim();
    try { inputs.collected = JSON.parse(body); } catch { /* leave undefined */ }
    return { phase: 'confirm', inputs };
  }
  if (trimmed === '[hv-confirm:generate]') {
    inputs.collected = lastFormSubmission(history);
    inputs.pickedType = lastTypePick(history);
    return { phase: 'generate', inputs };
  }
  if (trimmed === '[hv-confirm:edit]') {
    inputs.collected = lastFormSubmission(history);
    return { phase: 'info-edit', inputs };
  }

  // Without an explicit marker — what was the previous assistant card?
  const prevCard = lastAssistantCardKind(history);
  if (prevCard === 'hv-options') {
    // User answered the opener type-pick card.
    inputs.pickedType = trimmed;
    return { phase: 'info', inputs };
  }
  if (prevCard === 'hv-form' || prevCard === 'hv-confirm') {
    // Free-form text after a form/confirm card means the user typed
    // something instead of using the buttons. Fall through to iterate so
    // the agent can interpret it.
    inputs.collected = lastFormSubmission(history);
    return { phase: 'iterate', inputs };
  }

  // No prior card. Either truly first turn, or post-generation iteration.
  const hadGeneration = history.some(
    (m) => m.role === 'assistant' && /```html|```json#content-graph|✓\s/i.test(m.content),
  );
  if (hadGeneration) return { phase: 'iterate', inputs: { collected: lastFormSubmission(history) } };

  return { phase: 'opener', inputs };
}

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
  const { phase, inputs } = detectPhase(history, userText);

  // ---- opener ----
  if (phase === 'opener') {
    const opener: string[] = [];
    opener.push(
      `The user just opened a project and said "${trimmed}". You are an HTML-video creation assistant.`,
    );
    opener.push('');
    opener.push(`Reply with TWO things, in this exact order:`);
    opener.push(
      `1. ONE friendly opening sentence in the user's language (≤ 25 chars), e.g. "你好！想做点什么？" or "Hi! What kind of video?".`,
    );
    opener.push(
      `2. A fenced \`\`\`hv-options block with 4 content-type choices and allow_freeform: true. JSON shape:`,
    );
    opener.push('   ```hv-options');
    opener.push('   {');
    opener.push('     "question": "想做哪种内容？" or "What kind?",');
    opener.push('     "options": [');
    opener.push('       { "label": "单帧标题卡", "hint": "logo / 封面 / 单画面 - 5-10s" },');
    opener.push('       { "label": "多帧预告片", "hint": "产品 / 活动 teaser, 3-6 帧" },');
    opener.push('       { "label": "数据大字报", "hint": "1-2 个核心数字, 社媒爆款风" },');
    opener.push('       { "label": "概念解说短片", "hint": "几帧讲清一个 idea / feature" }');
    opener.push('     ],');
    opener.push('     "allow_freeform": true');
    opener.push('   }');
    opener.push('   ```');
    opener.push('');
    if (tmpl) {
      opener.push(
        `Note: a template "${tmpl.name}" is currently selected (${tmpl.description}), but treat it as a visual style reference only — content type still drives the structure.`,
      );
      opener.push('');
    }
    opener.push(`Do NOT write HTML this turn. Do NOT return an empty reply. The hv-options block is REQUIRED.`);
    return opener.join('\n');
  }

  // ---- info / info-edit: emit hv-form ----
  if (phase === 'info' || phase === 'info-edit') {
    const isEdit = phase === 'info-edit';
    const pre = inputs.collected ?? {};
    const pickedType = isEdit ? lastTypePick(history) : inputs.pickedType;
    const isMulti = !!pickedType && /多帧|预告|时间线|对比|讲解|teaser|explainer|comparison|timeline/i.test(pickedType);
    const defaults = {
      topic: pre.topic ?? '',
      headline: pre.headline ?? '',
      data: pre.data ?? '',
      aspect: pre.aspect ?? '16:9',
      duration: pre.duration ?? (isMulti ? '15' : '5'),
      frame_count: pre.frame_count ?? (isMulti ? '4' : '1'),
      style: pre.style ?? '',
    };
    const p: string[] = [];
    if (isEdit) {
      p.push(`The user wants to revise the inputs they submitted earlier. Re-emit the SAME hv-form card with each \`default\` field set to their last answer so they only have to change what they want.`);
    } else {
      p.push(`The user picked "${pickedType ?? 'a content type'}". Now collect the concrete inputs needed to generate the video — emit ONE \`\`\`hv-form block with the fields below, and a brief one-line preamble in the user's language inviting them to fill it in.`);
    }
    p.push('');
    p.push('```hv-form');
    p.push(JSON.stringify({
      title: isEdit ? '改一下这些信息' : '讲一下你想做的视频…',
      fields: [
        { key: 'topic',       label: '主题 / 是关于什么的',  kind: 'text',     placeholder: '例如：nexu-io 产品发布', required: true, default: defaults.topic },
        { key: 'headline',    label: 'Headline / 主标题',     kind: 'text',     placeholder: '例如：The Self-Evolving Design Agent', required: true, default: defaults.headline },
        { key: 'data',        label: '关键数字 / 数据 (可选)', kind: 'textarea', placeholder: '例如：50K stars in 25 days\nTemplates: 231 / Skills: 15', default: defaults.data },
        { key: 'aspect',      label: '画面尺寸',              kind: 'select',   options: ['16:9 横屏','9:16 手机竖屏','1:1 方形','4:5 小红书'], required: true, default: defaults.aspect.length === 3 || defaults.aspect.length === 4 ? `${defaults.aspect}${defaults.aspect === '16:9' ? ' 横屏' : defaults.aspect === '9:16' ? ' 手机竖屏' : defaults.aspect === '1:1' ? ' 方形' : ' 小红书'}` : defaults.aspect },
        { key: 'duration',    label: '时长 (秒)',             kind: 'select',   options: ['3','5','10','15','30'], required: true, default: defaults.duration },
        { key: 'frame_count', label: isMulti ? '帧数 (画面数)' : '帧数', kind: 'text', placeholder: isMulti ? '例如：4' : '单帧 = 1', required: true, default: defaults.frame_count },
        { key: 'style',       label: '风格描述 (可选)',       kind: 'textarea', placeholder: '例如：cyberpunk glitch / Swiss minimalist', default: defaults.style },
      ],
      allow_attachments: true,
    }, null, 2));
    p.push('```');
    p.push('');
    p.push(`Do NOT write HTML this turn. Do NOT return an empty reply. The hv-form block is REQUIRED.`);
    return p.join('\n');
  }

  // ---- confirm: emit hv-confirm summarising what was collected ----
  if (phase === 'confirm') {
    const collected = inputs.collected ?? {};
    const pickedType = lastTypePick(history) ?? '';
    const summaryRows: { label: string; value: string }[] = [];
    if (pickedType) summaryRows.push({ label: '类型', value: pickedType });
    const labelMap: Record<string, string> = {
      topic: '主题', headline: 'Headline', data: '数据', aspect: '尺寸',
      duration: '时长', frame_count: '帧数', style: '风格',
    };
    for (const k of ['topic', 'headline', 'data', 'aspect', 'duration', 'frame_count', 'style']) {
      const v = collected[k];
      if (v) summaryRows.push({ label: labelMap[k] ?? k, value: v });
    }
    if (attachments.length > 0) {
      summaryRows.push({ label: '素材', value: attachments.map((a) => a.filename).join(', ') });
    }

    const p: string[] = [];
    p.push(`The user has filled in their inputs. Emit ONE \`\`\`hv-confirm block (no other code blocks) summarising what you've got, in the user's language. Use this exact JSON:`);
    p.push('');
    p.push('```hv-confirm');
    p.push(JSON.stringify({
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
    const aspect = ((collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9'); // strip "16:9 横屏" → "16:9"
    const [w, h] = aspect.includes(':') ? aspect.split(':').map(Number) : [16, 9];
    const isMulti = /多帧|预告|时间线|对比|讲解|teaser|explainer|comparison|timeline/i.test(pickedType)
      || Number(collected.frame_count ?? '1') > 1;

    // Pick a concrete pixel resolution that respects the aspect choice.
    let resolution = '1920×1080';
    if (aspect === '9:16') resolution = '1080×1920';
    else if (aspect === '1:1') resolution = '1080×1080';
    else if (aspect === '4:5') resolution = '1080×1350';

    const p: string[] = [];
    p.push(`Generate the HTML video file(s) the user just confirmed.`);
    p.push('');
    p.push(`Inputs (use these LITERALLY — do NOT make up brand names or facts):`);
    p.push(`- 类型 / type: ${pickedType || '(未指定)'}`);
    if (collected.topic)       p.push(`- 主题 / topic: ${collected.topic}`);
    if (collected.headline)    p.push(`- Headline: ${collected.headline}`);
    if (collected.data)        p.push(`- 关键数字 / data:\n  ${collected.data.replace(/\n/g, '\n  ')}`);
    if (collected.style)       p.push(`- 风格: ${collected.style}`);
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
  // Tight prompt: agent should treat user's text as a revision instruction
  // applied to the existing preview HTML (or storyboard). No decision tree,
  // no card schemas — those are over.
  const it: string[] = [];
  it.push(`The user is iterating on an existing HTML video. Apply their revision request below to the prior preview HTML, keeping the visual identity unless they ask for a different one.`);
  it.push('');
  it.push(`# User revision request`);
  it.push(userText);
  it.push('');
  if (attachments.length > 0) {
    it.push(`# Attachments`);
    for (const a of attachments) it.push(`- [${a.kind}] ${a.filename} — ${a.path}`);
    it.push('');
  }
  if (baseHtml) {
    it.push(`# Prior preview HTML`);
    it.push('```html');
    it.push(baseHtml.slice(0, 6000));
    it.push('```');
    it.push('');
  }
  it.push(`Output: ONE complete HTML document inside a fenced \`\`\`html code block. Inline all CSS / JS. Tag visible text with data-hv-text. No prose outside the block. Do NOT emit hv-options / hv-form / hv-confirm — those are over.`);
  return it.join('\n');
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
