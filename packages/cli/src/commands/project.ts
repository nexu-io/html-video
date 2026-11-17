/**
 * Project-centric CLI commands per RFC-05.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Project } from '@html-video/core';
import type { CliContext } from '../context.js';
import { fail, ok, progress } from '../output.js';

export async function projectCreate(
  ctx: CliContext,
  opts: { name: string; intent?: string; aspect?: string; commercial?: boolean },
): Promise<void> {
  if (!opts.name) fail('invalid-input', '--name required');
  const project = await ctx.orchestrator.create({
    name: opts.name,
    ...(opts.intent !== undefined && { intent: opts.intent }),
    preferences: {
      ...(opts.aspect !== undefined && { aspect: opts.aspect }),
      ...(opts.commercial !== undefined && { commercial: opts.commercial }),
    },
  });
  ok({ project_id: project.id, name: project.name, project_status: project.status });
}

export async function projectList(ctx: CliContext): Promise<void> {
  const projects = await ctx.orchestrator.list();
  ok({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      template_id: p.templateId,
      asset_count: p.assets.length,
      frame_count: p.frames?.length ?? 0,
      has_content_graph: !!p.contentGraphPath,
      status: p.status,
      updated_at: p.updatedAt,
    })),
  });
}

export async function projectShow(ctx: CliContext, id: string): Promise<void> {
  const project = await ctx.orchestrator.load(id);
  ok({ project });
}

export async function projectDelete(ctx: CliContext, id: string): Promise<void> {
  await ctx.orchestrator.remove(id);
  ok({ project_id: id, deleted: true });
}

export async function projectAddAsset(
  ctx: CliContext,
  id: string,
  opts: {
    file?: string;
    inlineText?: string;
    inlineDataFile?: string;
    caption?: string;
  },
): Promise<void> {
  let project: Project | undefined;
  if (opts.file) {
    const f = resolve(opts.file);
    if (!existsSync(f)) fail('asset-not-found', `File not found: ${f}`);
    project = await ctx.orchestrator.addFileAsset(id, f, opts.caption);
  } else if (opts.inlineText) {
    project = await ctx.orchestrator.addInlineAsset(id, opts.inlineText, 'text', opts.caption);
  } else if (opts.inlineDataFile) {
    const f = resolve(opts.inlineDataFile);
    if (!existsSync(f)) fail('asset-not-found', `Data file not found: ${f}`);
    const content = await readFile(f, 'utf8');
    project = await ctx.orchestrator.addInlineAsset(id, content, 'data', opts.caption);
  } else {
    fail('invalid-input', 'Provide one of --file, --inline-text, --inline-data-file');
  }
  ok({
    project_id: project?.id,
    asset_count: project?.assets.length,
    last_added: project?.assets[project?.assets.length - 1],
  });
}

export async function projectRemoveAsset(
  ctx: CliContext,
  id: string,
  assetId: string,
): Promise<void> {
  const project = await ctx.orchestrator.removeAsset(id, assetId);
  ok({ project_id: project.id, asset_count: project.assets.length });
}

export async function projectSetTemplate(
  ctx: CliContext,
  id: string,
  templateId: string,
): Promise<void> {
  const project = await ctx.orchestrator.setTemplate(id, templateId);
  ok({
    project_id: project.id,
    template_id: project.templateId,
    variables: project.variables,
  });
}

export async function projectSetVar(
  ctx: CliContext,
  id: string,
  key: string,
  valueJson: string,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(valueJson);
  } catch {
    // not JSON → keep raw string
    value = valueJson;
  }
  const project = await ctx.orchestrator.setVariable(id, key, value);
  ok({ project_id: project.id, variables: project.variables });
}

export async function projectSetVars(ctx: CliContext, id: string, varsFile: string): Promise<void> {
  const f = resolve(varsFile);
  if (!existsSync(f)) fail('invalid-input', `vars file not found: ${f}`);
  const vars = JSON.parse(await readFile(f, 'utf8')) as Record<string, unknown>;
  const project = await ctx.orchestrator.setVariables(id, vars);
  ok({ project_id: project.id, variables: project.variables });
}

export async function projectPreview(ctx: CliContext, id: string): Promise<void> {
  const { project, htmlPath } = await ctx.orchestrator.renderPreviewHtml(id);
  ok({
    project_id: project.id,
    html_path: htmlPath,
    poster_path: project.lastPreviewPosterPath,
    note: 'Open html_path in a browser to preview, or use `html-video studio` for full UI.',
  });
}

export async function projectRender(
  ctx: CliContext,
  id: string,
  opts: { output?: string; streamProgress?: boolean },
): Promise<void> {
  const { project, outputPath } = await ctx.orchestrator.exportMp4({
    projectId: id,
    ...(opts.output !== undefined && { outputPath: resolve(opts.output) }),
    onProgress: opts.streamProgress ? (pct, stage) => progress(stage, pct) : undefined,
  });
  ok({ project_id: project.id, output_path: outputPath, project_status: project.status });
}

// ---------------- v0.8: content-graph + multi-frame CLI (RFC-06) ----------------

export async function projectGetGraph(ctx: CliContext, id: string): Promise<void> {
  const graph = await ctx.orchestrator.readContentGraph(id);
  if (!graph) fail('invalid-input', 'Project has no content graph');
  ok({ project_id: id, graph });
}

export async function projectSetGraph(
  ctx: CliContext,
  id: string,
  opts: { graphFile: string; preserveFrames?: boolean },
): Promise<void> {
  if (!opts.graphFile) fail('invalid-input', '--graph-file required');
  const f = resolve(opts.graphFile);
  if (!existsSync(f)) fail('invalid-input', `graph file not found: ${f}`);
  let graph: unknown;
  try {
    graph = JSON.parse(await readFile(f, 'utf8'));
  } catch {
    fail('invalid-input', `graph file is not valid JSON: ${f}`);
  }
  const { project, graphPath } = await ctx.orchestrator.writeContentGraph(
    id,
    graph as import('@html-video/content-graph').ContentGraph,
    {
      ...(opts.preserveFrames !== undefined && { preserveFrames: opts.preserveFrames }),
    },
  );
  ok({
    project_id: project.id,
    graph_path: graphPath,
    frame_count: project.frames?.length ?? 0,
    project_status: project.status,
  });
}

export async function projectWriteFrame(
  ctx: CliContext,
  id: string,
  opts: { node: string; htmlFile?: string; html?: string },
): Promise<void> {
  if (!opts.node) fail('invalid-input', '--node required');
  let html: string;
  if (opts.htmlFile) {
    const f = resolve(opts.htmlFile);
    if (!existsSync(f)) fail('invalid-input', `html file not found: ${f}`);
    html = await readFile(f, 'utf8');
  } else if (opts.html !== undefined) {
    html = opts.html;
  } else {
    fail('invalid-input', 'Provide --html-file or --html');
  }
  const { project, frame } = await ctx.orchestrator.writeFrameHtml(id, opts.node, html);
  ok({
    project_id: project.id,
    frame: {
      graph_node_id: frame.graphNodeId,
      html_path: frame.htmlPath,
      order: frame.order,
      duration_sec: frame.durationSec,
      engine: frame.engine,
      native_template_id: frame.nativeTemplateId,
    },
    frame_count: project.frames?.length ?? 0,
    project_status: project.status,
  });
}

export async function projectEnhanceFrame(
  ctx: CliContext,
  id: string,
  opts: { node: string; nativeTemplate: string },
): Promise<void> {
  if (!opts.node) fail('invalid-input', '--node required');
  if (!opts.nativeTemplate) fail('invalid-input', '--native-template required');
  const { project, frame } = await ctx.orchestrator.enhanceFrameNative(
    id,
    opts.node,
    opts.nativeTemplate,
  );
  ok({
    project_id: project.id,
    frame: {
      graph_node_id: frame.graphNodeId,
      engine: frame.engine,
      native_template_id: frame.nativeTemplateId,
      data: frame.data,
    },
    project_status: project.status,
  });
}

export async function projectUnenhanceFrame(
  ctx: CliContext,
  id: string,
  nodeId: string,
): Promise<void> {
  if (!nodeId) fail('invalid-input', '--node required');
  const { project, frame } = await ctx.orchestrator.unenhanceFrame(id, nodeId);
  ok({
    project_id: project.id,
    frame: {
      graph_node_id: frame.graphNodeId,
      engine: frame.engine,
      native_template_id: frame.nativeTemplateId,
    },
    project_status: project.status,
  });
}
