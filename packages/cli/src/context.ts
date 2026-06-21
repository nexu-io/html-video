/**
 * Bootstrap shared CLI context: project root, registries, stores, orchestrator.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AssetStore,
  EngineRegistry,
  ProjectOrchestrator,
  ProjectStore,
  SourceRegistry,
  TemplateRegistry,
} from '@html-video/core';
import hfAdapter from '@html-video/adapter-hyperframes';
import remotionAdapter, { remotionInstalled } from '@html-video/adapter-remotion';
import whisperAdapter from '@html-video/adapter-whisper';
import { MediaConfigStore } from './media-config.js';

export interface CliContext {
  projectRoot: string;
  engines: EngineRegistry;
  sources: SourceRegistry;
  templates: TemplateRegistry;
  projects: ProjectStore;
  assets: AssetStore;
  orchestrator: ProjectOrchestrator;
  templatesDir: string;
  mediaConfig: MediaConfigStore;
}

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.html-video'))) return dir;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'templates'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function findTemplatesDir(projectRoot: string): string {
  const candidates = [
    join(projectRoot, 'templates'),
    // packages/cli/dist/context.js → up 3 levels → monorepo root → templates/
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'templates'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

export async function bootstrap(opts: { cwd?: string } = {}): Promise<CliContext> {
  const projectRoot = findProjectRoot(opts.cwd);

  const engines = new EngineRegistry();
  engines.register(hfAdapter);
  // Register Remotion only when its peer deps are actually installed, so the
  // registry never lists an engine that would throw on render. (RFC-08)
  if (remotionInstalled()) {
    engines.register(remotionAdapter);
  }

  // RFC-11: footage ingest. whisper-local registers unconditionally; it throws
  // a friendly hint at transcribe time if whisper-cli / model are missing.
  const sources = new SourceRegistry();
  sources.register(whisperAdapter);

  const templates = new TemplateRegistry();
  const templatesDir = findTemplatesDir(projectRoot);
  await templates.scan(templatesDir);

  const projects = new ProjectStore(projectRoot);
  const assets = new AssetStore({ projectRoot });

  const orchestrator = new ProjectOrchestrator({
    projectRoot,
    engines,
    templates,
    projects,
    assets,
  });

  const mediaConfig = new MediaConfigStore(projectRoot);

  return { projectRoot, engines, sources, templates, projects, assets, orchestrator, templatesDir, mediaConfig };
}
