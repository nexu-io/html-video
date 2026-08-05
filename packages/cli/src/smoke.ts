/**
 * End-to-end smoke test for project-centric workflow (RFC-05).
 * Asserts: bootstrap → create project → add assets → set template → preview → render
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrap } from './context.js';

const log = (msg: string) => process.stdout.write(`▸ ${msg}\n`);
const ok = (msg: string) => process.stdout.write(`  ✓ ${msg}\n`);

/** Set HV_SMOKE_FAST=1 to skip Playwright/ffmpeg MP4 export (CI default). */
const FAST = process.env.HV_SMOKE_FAST === '1' || process.env.HV_SMOKE_FAST === 'true';

async function main() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'html-video-smoke-'));
  await mkdir(join(projectRoot, '.html-video'), { recursive: true });
  log(`workdir: ${projectRoot}`);

  const monorepoRoot = resolve(__dirname_polyfill(), '..', '..', '..');

  const fakeLogoPath = join(projectRoot, 'fake-logo.png');
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(fakeLogoPath, PNG_1x1);

  log('bootstrap context');
  const ctx = await bootstrap({ cwd: projectRoot });
  if (ctx.templates.list().length === 0) {
    await ctx.templates.scan(join(monorepoRoot, 'templates'));
  }
  ok(
    `engines: ${ctx.engines
      .list()
      .map((e) => e.id)
      .join(', ')}`,
  );
  ok(
    `templates: ${ctx.templates
      .list()
      .map((t) => t.id)
      .join(', ')}`,
  );

  // 1. Create a project
  log('project create');
  const project1 = await ctx.orchestrator.create({
    name: 'OD Plugin Library Demo',
    intent: 'Show OD plugin library distribution',
    preferences: { aspect: '16:9', commercial: true },
  });
  ok(`project ${project1.id} status=${project1.status}`);

  // 2. Add assets
  log('add image asset');
  let p = await ctx.orchestrator.addFileAsset(project1.id, fakeLogoPath, 'OD logo');
  ok(`assets=${p.assets.length}`);

  log('add inline text asset');
  p = await ctx.orchestrator.addInlineAsset(project1.id, 'Design that evolves itself', 'text');
  ok(`assets=${p.assets.length}`);

  log('add inline data asset');
  const chartData = JSON.stringify([
    { label: 'Templates', value: 231, color: '#ffb84d' },
    { label: 'Skills', value: 15, color: '#9b87f5' },
    { label: 'Systems', value: 150, color: '#6dd99c' },
    { label: 'Craft', value: 11, color: '#ff8a4d' },
  ]);
  p = await ctx.orchestrator.addInlineAsset(project1.id, chartData, 'data');
  ok(`assets=${p.assets.length}`);

  // 3. Pick a template
  log('set template = frame-data-chart-nyt');
  p = await ctx.orchestrator.setTemplate(project1.id, 'frame-data-chart-nyt');
  ok(
    `templateId=${p.templateId} variables(after-defaults)=${JSON.stringify(p.variables).slice(0, 80)}…`,
  );

  // 4. Set variables (use the chart data we just added)
  log('set variables');
  p = await ctx.orchestrator.setVariables(project1.id, {
    title: 'OD Plugin Library Distribution',
    subtitle: '2026-05-27',
    data: JSON.parse(chartData),
    value_format: 'number',
    duration_sec: 8,
  });
  ok('variables saved');

  // 5. Render preview HTML
  log('render preview html');
  const { project: previewedProj, htmlPath } = await ctx.orchestrator.renderPreviewHtml(
    project1.id,
  );
  if (!existsSync(htmlPath)) throw new Error(`Preview HTML missing: ${htmlPath}`);
  const content = await readFile(htmlPath, 'utf8');
  if (!content.includes('<html')) throw new Error('Preview HTML malformed');
  ok(`status=${previewedProj.status} html=${htmlPath}`);

  // 6. Switch template to test variable preservation
  log('switch template to frame-glitch-title');
  p = await ctx.orchestrator.setTemplate(project1.id, 'frame-glitch-title');
  ok(`now templateId=${p.templateId} kept-vars=${JSON.stringify(p.variables)}`);

  // 7. Switch back + render again
  log('switch back to frame-data-chart-nyt');
  p = await ctx.orchestrator.setTemplate(project1.id, 'frame-data-chart-nyt');
  p = await ctx.orchestrator.setVariables(project1.id, {
    title: 'OD Plugin Library Distribution',
    data: JSON.parse(chartData),
    duration_sec: 8,
  });

  // 8. Export MP4 (requires Playwright Chromium + ffmpeg; skip in HV_SMOKE_FAST mode)
  if (FAST) {
    log('export MP4 (skipped — HV_SMOKE_FAST=1)');
    ok('MP4 export skipped in fast smoke mode');
  } else {
    log('export MP4');
    const { project: rendered, outputPath } = await ctx.orchestrator.exportMp4({
      projectId: project1.id,
      onProgress: (pct, stage) => {
        if (pct === 0 || pct === 100 || pct % 25 === 0) ok(`render ${stage} ${pct}%`);
      },
    });
    if (!existsSync(outputPath)) throw new Error('MP4 output missing');
    ok(`status=${rendered.status} mp4=${outputPath}`);
  }

  // 9. v0.8: ContentGraph + multi-frame self-test
  log('v0.8 multi-frame: write content-graph + 3 frames');
  const project2 = await ctx.orchestrator.create({
    name: 'Multi-frame explainer demo',
    intent: 'Test content-graph + frames pipeline',
    preferences: {},
  });
  const graph = {
    schemaVersion: 1 as const,
    intent: 'explainer' as const,
    synopsis: 'Smoke-test explainer with three frames',
    nodes: [
      { id: 'intro', kind: 'text' as const, text: 'Hello world', durationSec: 2 },
      { id: 'middle', kind: 'data' as const, data: { v: 42 }, durationSec: 4 },
      { id: 'outro', kind: 'entity' as const, props: { logo: 'OD' }, durationSec: 3 },
    ],
    edges: [
      { from: 'intro', to: 'middle', kind: 'sequence' as const },
      { from: 'middle', to: 'outro', kind: 'dependency' as const },
    ],
  };
  await ctx.orchestrator.writeContentGraph(project2.id, graph);
  ok('graph persisted + validated');

  for (const node of graph.nodes) {
    const html = `<!doctype html><html><head><title>${node.id}</title></head><body data-hv-text="${node.id}">${node.id}</body></html>`;
    const { frame } = await ctx.orchestrator.writeFrameHtml(project2.id, node.id, html);
    ok(
      `frame written: ${frame.graphNodeId} order=${frame.order} dur=${frame.durationSec}s path=${frame.htmlPath.split('/').slice(-3).join('/')}`,
    );
  }

  const finalProject = await ctx.orchestrator.load(project2.id);
  if (!finalProject.frames || finalProject.frames.length !== 3) {
    throw new Error(`expected 3 frames, got ${finalProject.frames?.length}`);
  }
  // Order should be: intro (no deps), middle (after intro by sequence + before outro), outro (depends on middle)
  const order = finalProject.frames.map((f) => f.graphNodeId).join(',');
  if (order !== 'intro,middle,outro') {
    throw new Error(`unexpected play order: ${order}`);
  }
  ok(`play order: ${order}`);

  // 10. Verify project list works
  log('list projects');
  const all = await ctx.orchestrator.list();
  ok(`${all.length} project(s) in store`);

  process.stdout.write('\n✅ smoke test passed\n');
}

function __dirname_polyfill(): string {
  const url = import.meta.url;
  const path = url.replace(/^file:\/\//, '');
  return path.replace(/\/[^/]*$/, '');
}

main().catch((err) => {
  process.stderr.write(`\n❌ smoke test failed: ${err.message ?? err}\n`);
  if (err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
