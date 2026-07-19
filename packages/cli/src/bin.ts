#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cacModule from 'cac';
import { runDoctor } from './commands/doctor.js';
import { listEngines } from './commands/list-engines.js';
import { listNativeTemplates } from './commands/list-native-templates.js';
import {
  projectAddAsset,
  projectCreate,
  projectDelete,
  projectEnhanceFrame,
  projectGetGraph,
  projectList,
  projectPreview,
  projectRemoveAsset,
  projectRender,
  projectSetGraph,
  projectSetTemplate,
  projectSetVar,
  projectSetVars,
  projectShow,
  projectUnenhanceFrame,
  projectWriteFrame,
} from './commands/project.js';
import { inspectTemplate, searchTemplates } from './commands/templates.js';
import { bootstrap } from './context.js';
import { fail, ok, setJsonMode } from './output.js';
import { startStudioServer } from './studio-server.js';

// cac is a CJS default export; ESM interop sometimes wraps it in `.default`
// biome-ignore lint/suspicious/noExplicitAny: cac's types don't expose this shape
const cacFn: (name: string) => any =
  typeof cacModule === 'function' ? (cacModule as any) : (cacModule as any).default;
const cli = cacFn('html-video');

cli.option('--json', 'JSON output (default: on)', { default: true });
cli.option('--no-color', 'disable ANSI colors');
cli.option('--cwd <path>', 'project root');

cli.command('doctor', 'Diagnose environment').action(async (opts: any) => {
  setJsonMode(!!opts.json);
  const ctx = await bootstrap({ cwd: opts.cwd });
  await runDoctor(ctx);
});

cli.command('list-engines', 'List installed engine adapters').action(async (opts: any) => {
  setJsonMode(!!opts.json);
  const ctx = await bootstrap({ cwd: opts.cwd });
  await listEngines(ctx);
});

cli
  .command('list-native-templates', 'List native Remotion templates for frame enhancement')
  .action(async (opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await listNativeTemplates(ctx);
  });

cli
  .command('search-templates', 'Search templates by intent')
  .option('--intent <text>', 'Free-text user intent')
  .option('--aspect <ratio>', '16:9 / 9:16 / 1:1')
  .option('--license-allow <list>', 'Comma-separated SPDX ids')
  .option('--top <n>', 'Top N matches', { default: 5 })
  .action(async (opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await searchTemplates(ctx, {
      intent: opts.intent,
      aspect: opts.aspect,
      licenseAllow: opts.licenseAllow,
      top: Number(opts.top),
    });
  });

cli
  .command('inspect-template <id>', 'Show full metadata for a template')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await inspectTemplate(ctx, id);
  });

// ====== project-* commands (RFC-05) ======

cli
  .command('project-create', 'Create a new project')
  .option('--name <text>', 'Project name (required)')
  .option('--intent <text>', 'One-sentence description')
  .option('--aspect <ratio>', '16:9 / 9:16 / 1:1')
  .option('--commercial', 'Mark as commercial-use')
  .action(async (opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectCreate(ctx, {
      name: opts.name,
      intent: opts.intent,
      aspect: opts.aspect,
      commercial: !!opts.commercial,
    });
  });

cli.command('project-list', 'List all projects').action(async (opts: any) => {
  setJsonMode(!!opts.json);
  const ctx = await bootstrap({ cwd: opts.cwd });
  await projectList(ctx);
});

cli.command('project-show <id>', 'Show project details').action(async (id: string, opts: any) => {
  setJsonMode(!!opts.json);
  const ctx = await bootstrap({ cwd: opts.cwd });
  await projectShow(ctx, id);
});

cli.command('project-delete <id>', 'Delete a project').action(async (id: string, opts: any) => {
  setJsonMode(!!opts.json);
  const ctx = await bootstrap({ cwd: opts.cwd });
  await projectDelete(ctx, id);
});

cli
  .command('project-add-asset <id>', 'Add an asset to a project')
  .option('--file <path>', 'Path to a file (image / video / audio / data)')
  .option('--inline-text <text>', 'Inline text content')
  .option('--inline-data-file <path>', 'Path to JSON / CSV file to embed as data asset')
  .option('--caption <text>', 'Optional caption')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectAddAsset(ctx, id, {
      file: opts.file,
      inlineText: opts.inlineText,
      inlineDataFile: opts.inlineDataFile,
      caption: opts.caption,
    });
  });

cli
  .command('project-remove-asset <id>', 'Remove an asset from a project')
  .option('--asset <assetId>', 'Asset id to remove (required)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.asset) fail('invalid-input', '--asset required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectRemoveAsset(ctx, id, opts.asset);
  });

cli
  .command('project-set-template <id>', 'Pick a template for the project')
  .option('--template <templateId>', 'Template id (required)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.template) fail('invalid-input', '--template required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectSetTemplate(ctx, id, opts.template);
  });

cli
  .command('project-set-var <id>', 'Set a single variable')
  .option('--key <name>', 'Variable name')
  .option('--value <json>', 'Value (parsed as JSON if possible, else string)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.key) fail('invalid-input', '--key required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectSetVar(ctx, id, opts.key, opts.value);
  });

cli
  .command('project-set-vars <id>', 'Replace all variables from a JSON file')
  .option('--vars-file <path>', 'Path to JSON file (required)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.varsFile) fail('invalid-input', '--vars-file required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectSetVars(ctx, id, opts.varsFile);
  });

cli
  .command('project-preview <id>', 'Render an HTML preview of the project')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectPreview(ctx, id);
  });

cli
  .command('project-render <id>', 'Export the project to MP4')
  .option('--output <path>', 'Output MP4 path')
  .option('--stream-progress', 'Emit progress as NDJSON')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectRender(ctx, id, {
      output: opts.output,
      streamProgress: !!opts.streamProgress,
    });
  });

// ====== v0.8: content-graph + multi-frame (RFC-06) ======

cli
  .command('project-get-graph <id>', 'Read the project content-graph JSON')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectGetGraph(ctx, id);
  });

cli
  .command('project-set-graph <id>', 'Write a content-graph from a JSON file')
  .option('--graph-file <path>', 'Path to content-graph JSON (required)')
  .option('--preserve-frames', 'Keep existing frames; only sync durations from graph')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectSetGraph(ctx, id, {
      graphFile: opts.graphFile,
      preserveFrames: !!opts.preserveFrames,
    });
  });

cli
  .command('project-write-frame <id>', 'Write HTML for one graph node')
  .option('--node <nodeId>', 'Graph node id (required)')
  .option('--html-file <path>', 'Path to frame HTML file')
  .option('--html <text>', 'Inline HTML string')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectWriteFrame(ctx, id, {
      node: opts.node,
      htmlFile: opts.htmlFile,
      html: opts.html,
    });
  });

cli
  .command('project-enhance-frame <id>', 'Enhance a data frame with a native Remotion template')
  .option('--node <nodeId>', 'Graph node id (required)')
  .option('--native-template <templateId>', 'Native Remotion template id (required)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectEnhanceFrame(ctx, id, {
      node: opts.node,
      nativeTemplate: opts.nativeTemplate,
    });
  });

cli
  .command('project-unenhance-frame <id>', 'Revert a frame from native Remotion back to HTML')
  .option('--node <nodeId>', 'Graph node id (required)')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.node) fail('invalid-input', '--node required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectUnenhanceFrame(ctx, id, opts.node);
  });

// ====== Studio (HTML Anything-style three-pane UI) ======

cli
  .command('studio', 'Launch the project studio in the browser')
  .option('--port <n>', 'Port (default 3071)', { default: 3071 })
  .action(async (opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    const handle = await startStudioServer(ctx, Number(opts.port));
    ok({
      url: handle.url,
      port: handle.port,
      pid: process.pid,
      project_count: (await ctx.orchestrator.list()).length,
      template_count: ctx.templates.list().length,
      note: 'Studio running. Press Ctrl+C to stop.',
    });
    process.on('SIGINT', () => {
      handle.close();
      process.exit(0);
    });
  });

cli.help();
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string };
cli.version(pkg.version);
cli.parse();
