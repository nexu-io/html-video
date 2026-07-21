/**
 * Global per-agent model selections for this html-video workspace.
 *
 * Only user selections are persisted. Discovered catalogs stay in the Studio
 * server's memory and are never treated as a source of truth on disk.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidModelId } from '@html-video/runtime';

interface AgentConfigFile {
  version: 1;
  models: Record<string, string>;
}

const EMPTY_CONFIG: AgentConfigFile = { version: 1, models: {} };

export function resolveAgentModelSelection(
  projectModel: string | null | undefined,
  globalModel: string | null | undefined,
): string | undefined {
  return projectModel?.trim() || globalModel?.trim() || undefined;
}

export class AgentConfigStore {
  private readonly path: string;
  private readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, '.html-video');
    this.path = join(this.dir, 'agent-config.json');
  }

  private read(): AgentConfigFile {
    if (!existsSync(this.path)) return { ...EMPTY_CONFIG, models: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AgentConfigFile>;
      if (!parsed.models || typeof parsed.models !== 'object' || Array.isArray(parsed.models)) {
        return { ...EMPTY_CONFIG, models: {} };
      }
      const models: Record<string, string> = {};
      for (const [agentId, model] of Object.entries(parsed.models)) {
        if (agentId && isValidModelId(model)) models[agentId] = model.trim();
      }
      return { version: 1, models };
    } catch {
      return { ...EMPTY_CONFIG, models: {} };
    }
  }

  private write(config: AgentConfigFile): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    const tempPath = `${this.path}.tmp-${process.pid}`;
    try {
      writeFileSync(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      renameSync(tempPath, this.path);
    } finally {
      if (existsSync(tempPath)) rmSync(tempPath, { force: true });
    }
  }

  get(agentId: string): string | null {
    return this.read().models[agentId] ?? null;
  }

  list(): Record<string, string> {
    return { ...this.read().models };
  }

  /** `null` means Automatic and removes the persisted override. */
  set(agentId: string, model: string | null): string | null {
    if (!agentId.trim()) throw new Error('Agent id is required.');
    const config = this.read();
    if (model === null || model.trim() === '') {
      delete config.models[agentId];
      this.write(config);
      return null;
    }
    const normalized = model.trim();
    if (!isValidModelId(normalized)) {
      throw new Error('Model id must be 1-200 characters using letters, numbers, dots, dashes, underscores, slashes, colons, plus signs or @.');
    }
    config.models[agentId] = normalized;
    this.write(config);
    return normalized;
  }
}
