#!/usr/bin/env node
import cacModule from 'cac';
import { bootstrap } from './context.js';
import { setJsonMode, ok, fail } from './output.js';
import { runDoctor } from './commands/doctor.js';
import { listEngines } from './commands/list-engines.js';
import { searchTemplates, inspectTemplate } from './commands/templates.js';
import {
  projectCreate,
  projectList,
  projectShow,
  projectDelete,
  projectAddAsset,
  projectRemoveAsset,
  projectSetTemplate,
  projectSetVar,
  projectSetVars,
  projectPreview,
  projectRender,
} from './commands/project.js';
import { footageEdit } from './commands/footage.js';
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

cli
  .command('project-show <id>', 'Show project details')
  .action(async (id: string, opts: any) => {
    setJsonMode(!!opts.json);
    const ctx = await bootstrap({ cwd: opts.cwd });
    await projectShow(ctx, id);
  });

cli
  .command('project-delete <id>', 'Delete a project')
  .action(async (id: string, opts: any) => {
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

// ====== Footage edit (RFC-11: edit real takes as text) ======

cli
  .command('footage-edit', 'Edit raw takes into a cut: transcribe → select → cut → verify')
  .option('--takes <dir>', 'Directory of take video files')
  .option('--scenes <file>', 'Scenes JSON (SceneSpec[]); default = one scene per take')
  .option('--out <file>', 'Output MP4 path (default: <work>/final.mp4)')
  .option('--work <dir>', 'Work dir for transcripts/cuts (default: <takes>/../hv-footage-work)')
  .option('--model <path>', 'Whisper ggml model (default: $HTMLVIDEO_WHISPER_MODEL)')
  .option('--source <id>', 'Source adapter id', { default: 'whisper-local' })
  .action(async (opts: any) => {
    setJsonMode(!!opts.json);
    if (!opts.takes) return fail('invalid-input', '--takes <dir> is required');
    const ctx = await bootstrap({ cwd: opts.cwd });
    await footageEdit(ctx, {
      takes: opts.takes,
      scenes: opts.scenes,
      out: opts.out,
      work: opts.work,
      model: opts.model,
      source: opts.source,
    });
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
cli.version('0.1.0');
cli.parse();
