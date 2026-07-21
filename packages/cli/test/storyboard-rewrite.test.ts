import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runSplitMultiFrameGenerate } from '../dist/studio-server.js';

const graphFixture = () => ({
  schemaVersion: 1,
  intent: 'explainer',
  synopsis: 'Original copy',
  nodes: [
    { id: 'intro', kind: 'text', text: 'Original intro', durationSec: 3 },
    { id: 'middle', kind: 'text', text: 'Original middle', durationSec: 3 },
    { id: 'outro', kind: 'entity', label: 'Original outro', durationSec: 3 },
  ],
  edges: [
    { from: 'intro', to: 'middle', kind: 'sequence' },
    { from: 'middle', to: 'outro', kind: 'sequence' },
  ],
});

function htmlReply(label: string): string {
  return `\u0060\u0060\u0060html\n<!doctype html><html><body>${label}</body></html>\n\u0060\u0060\u0060`;
}

function makeAgent(replyForCall: (call: number) => string, contexts: unknown[] = []) {
  let calls = 0;
  return {
    id: 'fixture-agent',
    name: 'Fixture Agent',
    bin: 'fixture',
    versionArgs: [],
    buildArgs: () => [],
    streamFormat: 'plain' as const,
    kind: 'http' as const,
    async httpHandler(_prompt: string, invokeContext: unknown, onEvent: (event: unknown) => void) {
      calls += 1;
      contexts.push(invokeContext);
      const reply = replyForCall(calls);
      if (reply) onEvent({ type: 'text', chunk: reply });
      return { exitCode: 0 };
    },
  };
}

function baseArgs(ctx: unknown, root: string, agentDef: unknown) {
  return {
    ctx: ctx as never,
    projectId: 'project-1',
    projectDir: root,
    agentDef: agentDef as never,
    agentModel: 'fixed-model',
    tmpl: null,
    priorHtml: '',
    inputs: {
      collected: { aspect: '9:16', per_frame: '5', frame_count: '2' },
      pickedType: 'Explainer',
      pickedStyle: 'Swiss',
      contentTurns: [],
    },
    attachments: [],
    openingTopic: 'Product',
    restyleOnly: true,
    onProgress: () => {},
    onSse: () => {},
  };
}

test('post-generation format keeps frame count/copy and applies new duration only after all frames succeed', async () => {
  const originalGraph = graphFixture();
  let currentGraph = structuredClone(originalGraph);
  let currentProject = {
    id: 'project-1',
    preferences: {},
    frames: [],
    contentGraphPath: 'content-graph.json',
  };
  const graphWrites = [];
  const frameWrites = [];
  const ctx = {
    projects: {
      load: async () => currentProject,
      save: async (project: typeof currentProject) => { currentProject = structuredClone(project); },
    },
    orchestrator: {
      readContentGraph: async () => structuredClone(currentGraph),
      writeContentGraph: async (_id: string, graph: typeof originalGraph, opts: unknown) => {
        currentGraph = structuredClone(graph);
        graphWrites.push({ graph: structuredClone(graph), opts });
        return { project: currentProject, graphPath: currentProject.contentGraphPath };
      },
      writeFrameHtml: async (_id: string, nodeId: string, html: string) => {
        frameWrites.push({ nodeId, html });
        return { project: currentProject, frame: {} };
      },
    },
  };

  const invokeContexts: Array<{ model?: string }> = [];
  const result = await runSplitMultiFrameGenerate(baseArgs(
    ctx,
    process.cwd(),
    makeAgent((call) => htmlReply(`frame-${call}`), invokeContexts),
  ));
  assert.equal(result.frameCount, 3, 'submitted stale frame_count must not drop an existing frame');
  assert.equal(graphWrites.length, 1);
  assert.deepEqual(graphWrites[0].opts, { preserveFrames: true });
  assert.deepEqual(graphWrites[0].graph.nodes.map((node) => node.text ?? node.label), [
    'Original intro',
    'Original middle',
    'Original outro',
  ]);
  assert.deepEqual(graphWrites[0].graph.nodes.map((node) => node.durationSec), [5, 5, 5]);
  assert.deepEqual(frameWrites.map((frame) => frame.nodeId), ['intro', 'middle', 'outro']);
  assert.deepEqual(currentProject.preferences, { resolution: { width: 1080, height: 1920 } });
  assert.deepEqual(invokeContexts.map((context) => context.model), ['fixed-model', 'fixed-model', 'fixed-model']);
});

test('agent failure during a rewrite leaves graph, frames and preferences untouched', async () => {
  const originalGraph = graphFixture();
  const originalProject = {
    id: 'project-1',
    preferences: { resolution: { width: 1920, height: 1080 } },
    frames: [{ graphNodeId: 'intro', htmlPath: 'old-intro.html', durationSec: 3, order: 0 }],
    contentGraphPath: 'content-graph.json',
  };
  let graphWriteCount = 0;
  let frameWriteCount = 0;
  let saveCount = 0;
  const ctx = {
    projects: {
      load: async () => structuredClone(originalProject),
      save: async () => { saveCount += 1; },
    },
    orchestrator: {
      readContentGraph: async () => structuredClone(originalGraph),
      writeContentGraph: async () => { graphWriteCount += 1; },
      writeFrameHtml: async () => { frameWriteCount += 1; },
    },
  };
  // Frame 1 succeeds; frame 2 and its one retry both return empty.
  const retryContexts: Array<{ model?: string }> = [];
  const agent = makeAgent((call) => call === 1 ? htmlReply('frame-1') : '', retryContexts);
  await assert.rejects(
    runSplitMultiFrameGenerate(baseArgs(ctx, process.cwd(), agent)),
    /generation returned empty/i,
  );
  assert.equal(graphWriteCount, 0);
  assert.equal(frameWriteCount, 0);
  assert.equal(saveCount, 0);
  assert.deepEqual(retryContexts.map((context) => context.model), ['fixed-model', 'fixed-model', 'fixed-model']);
});

test('commit failure restores overwritten frame HTML, graph JSON and project metadata', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'html-video-storyboard-rollback-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const graphPath = join(root, 'content-graph.json');
  const introPath = join(root, 'intro.html');
  const middlePath = join(root, 'middle.html');
  const outroPath = join(root, 'outro.html');
  const originalGraph = graphFixture();
  writeFileSync(graphPath, JSON.stringify(originalGraph, null, 2));
  writeFileSync(introPath, 'OLD INTRO');
  writeFileSync(middlePath, 'OLD MIDDLE');
  writeFileSync(outroPath, 'OLD OUTRO');

  const originalProject = {
    id: 'project-1',
    preferences: { resolution: { width: 1920, height: 1080 } },
    frames: [
      { graphNodeId: 'intro', htmlPath: introPath, durationSec: 3, order: 0 },
      { graphNodeId: 'middle', htmlPath: middlePath, durationSec: 3, order: 1 },
      { graphNodeId: 'outro', htmlPath: outroPath, durationSec: 3, order: 2 },
    ],
    contentGraphPath: graphPath,
  };
  let currentProject = structuredClone(originalProject);
  let currentGraph = structuredClone(originalGraph);
  let frameWrite = 0;
  const pathById = { intro: introPath, middle: middlePath, outro: outroPath };
  const ctx = {
    projects: {
      load: async () => structuredClone(currentProject),
      save: async (project: typeof currentProject) => { currentProject = structuredClone(project); },
    },
    orchestrator: {
      readContentGraph: async () => structuredClone(currentGraph),
      writeContentGraph: async (_id: string, graph: typeof originalGraph) => {
        currentGraph = structuredClone(graph);
        writeFileSync(graphPath, JSON.stringify(graph, null, 2));
        currentProject.frames = [];
        return { project: currentProject, graphPath };
      },
      writeFrameHtml: async (_id: string, nodeId: keyof typeof pathById, html: string) => {
        frameWrite += 1;
        if (frameWrite === 2) throw new Error('fixture disk failure');
        writeFileSync(pathById[nodeId], html);
        return { project: currentProject, frame: {} };
      },
    },
  };

  await assert.rejects(
    runSplitMultiFrameGenerate(baseArgs(ctx, root, makeAgent((call) => htmlReply(`new-${call}`)))),
    /fixture disk failure/,
  );
  assert.equal(readFileSync(introPath, 'utf8'), 'OLD INTRO');
  assert.equal(readFileSync(middlePath, 'utf8'), 'OLD MIDDLE');
  assert.deepEqual(JSON.parse(readFileSync(graphPath, 'utf8')), originalGraph);
  assert.deepEqual(currentProject, originalProject);
});
