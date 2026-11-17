/**
 * Registries for engine adapters, templates, and projects.
 * RFC-05: Storyboard removed; Project takes its place.
 */

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  EngineAdapter,
  EngineId,
  Project,
  SourceAdapter,
  TemplateMetadata,
} from './types/index.js';
import { HtmlVideoError } from './errors.js';

// ---------------------------------------------------------------------------
// EngineRegistry
// ---------------------------------------------------------------------------

export class EngineRegistry {
  private adapters = new Map<EngineId, EngineAdapter>();

  register(adapter: EngineAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: EngineId): EngineAdapter {
    const a = this.adapters.get(id);
    if (!a) {
      throw new HtmlVideoError(
        'engine-not-registered',
        `Engine "${id}" is not registered. Did you forget to install @html-video/adapter-${id}?`,
      );
    }
    return a;
  }

  list(): EngineAdapter[] {
    return [...this.adapters.values()];
  }

  has(id: EngineId): boolean {
    return this.adapters.has(id);
  }
}

// ---------------------------------------------------------------------------
// SourceRegistry (RFC-11: footage ingest adapters)
// ---------------------------------------------------------------------------

/** Registry of {@link SourceAdapter}s (transcription back-ends), mirroring
 *  {@link EngineRegistry}. Keyed by adapter id (e.g. 'whisper-local'). */
export class SourceRegistry {
  private adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): SourceAdapter {
    const a = this.adapters.get(id);
    if (!a) {
      throw new HtmlVideoError(
        'engine-not-registered',
        `Source adapter "${id}" is not registered. Did you forget to install @html-video/adapter-${id.replace(/-local$/, '')}?`,
      );
    }
    return a;
  }

  list(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }
}

// ---------------------------------------------------------------------------
// TemplateRegistry
// ---------------------------------------------------------------------------

export class TemplateRegistry {
  private templates = new Map<string, TemplateMetadata>();

  async scan(rootDir: string): Promise<TemplateMetadata[]> {
    if (!existsSync(rootDir)) return [];
    const entries = await readdir(rootDir, { withFileTypes: true });
    const found: TemplateMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(rootDir, entry.name);
      const yamlPath = join(dir, 'template.html-video.yaml');
      if (!existsSync(yamlPath)) continue;
      const raw = await readFile(yamlPath, 'utf8');
      const meta = parseYaml(raw) as TemplateMetadata;
      meta.__dir = dir;
      this.templates.set(meta.id, meta);
      found.push(meta);
    }
    return found;
  }

  get(id: string): TemplateMetadata {
    const t = this.templates.get(id);
    if (!t) {
      throw new HtmlVideoError('template-not-found', `Template "${id}" not found`);
    }
    return t;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  list(): TemplateMetadata[] {
    return [...this.templates.values()];
  }

  search(opts: {
    intent?: string;
    aspect?: string;
    licenseAllow?: string[];
    enginesAvailable?: EngineId[];
    top?: number;
  }): { template: TemplateMetadata; score: number; reason: string }[] {
    const top = opts.top ?? 5;
    const intentLower = (opts.intent ?? '').toLowerCase();
    const intentTokens = intentLower.split(/\W+/).filter((s) => s.length > 2);

    const ranked: { template: TemplateMetadata; score: number; reason: string }[] = [];

    for (const t of this.templates.values()) {
      const reasonParts: string[] = [];
      let score = 0;

      const haystack = [
        ...t.tags,
        ...t.best_for,
        t.name,
        t.description,
        t.category,
        t.subcategory ?? '',
      ]
        .join(' ')
        .toLowerCase();
      const matched = intentTokens.filter((tok) => haystack.includes(tok));
      if (matched.length > 0) {
        score += matched.length * 0.2;
        reasonParts.push(`matched ${matched.length} intent tokens`);
      }

      if (opts.aspect) {
        if (t.output.resolution.supported_aspects.includes(opts.aspect)) {
          score += 0.15;
          reasonParts.push(`aspect ${opts.aspect} supported`);
        } else {
          score -= 0.1;
        }
      }

      if (opts.licenseAllow && !opts.licenseAllow.includes(t.license.spdx)) {
        continue;
      }
      reasonParts.push(`license ${t.license.spdx} ok`);

      if (opts.enginesAvailable && !opts.enginesAvailable.includes(t.engine)) {
        continue;
      }

      score = Math.max(0, Math.min(1, score));

      ranked.push({
        template: t,
        score,
        reason: reasonParts.join('; '),
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, top);
  }
}

// ---------------------------------------------------------------------------
// ProjectStore — JSON-on-disk persistence
// ---------------------------------------------------------------------------

export class ProjectStore {
  constructor(private projectRoot: string) {}

  private dir(): string {
    return join(this.projectRoot, '.html-video', 'projects');
  }

  private projectDir(id: string): string {
    return join(this.dir(), id);
  }

  private path(id: string): string {
    return join(this.projectDir(id), 'project.json');
  }

  /** Ensure project directory exists; returns its absolute path. */
  async ensureDir(id: string): Promise<string> {
    const dir = this.projectDir(id);
    await mkdir(join(dir, 'assets'), { recursive: true });
    return dir;
  }

  async save(project: Project): Promise<void> {
    await this.ensureDir(project.id);
    project.updatedAt = new Date().toISOString();
    await writeFile(this.path(project.id), JSON.stringify(project, null, 2), 'utf8');
  }

  async load(id: string): Promise<Project> {
    const p = this.path(id);
    if (!existsSync(p)) {
      throw new HtmlVideoError('project-not-found', `Project ${id} not found`);
    }
    return JSON.parse(await readFile(p, 'utf8')) as Project;
  }

  async list(): Promise<Project[]> {
    const d = this.dir();
    if (!existsSync(d)) return [];
    const ids = await readdir(d);
    const out: Project[] = [];
    for (const id of ids) {
      try {
        out.push(await this.load(id));
      } catch {
        // skip corrupt
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  async remove(id: string): Promise<void> {
    const dir = this.projectDir(id);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
