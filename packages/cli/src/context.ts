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
  TemplateRegistry,
} from '@html-video/core';
import hfAdapter from '@html-video/adapter-hyperframes';
import remotionAdapter, { remotionInstalled } from '@html-video/adapter-remotion';
import { MediaConfigStore } from './media-config.js';

export interface CliContext {
  projectRoot: string;
  engines: EngineRegistry;
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
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    // scan() silently returns [] for a missing dir, which used to surface as a
    // baffling "0 templates" studio. Say what's actually wrong instead
    // (issue #57, finding 8).
    process.stderr.write(
      `⚠ no templates directory found — looked at:\n  ${candidates.join('\n  ')}\n` +
        'Run from the monorepo root (or a project with templates/); template commands will list nothing.\n',
    );
    return candidates[0]!;
  }
  return found;
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

  return {
    projectRoot,
    engines,
    templates,
    projects,
    assets,
    orchestrator,
    templatesDir,
    mediaConfig,
  };
}
