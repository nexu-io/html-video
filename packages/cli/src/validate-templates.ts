#!/usr/bin/env node
/**
 * Validate all templates under templates/ for RFC-07 provenance + file presence.
 * Exit 0 when all pass; exit 1 with a summary when any template fails.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

interface Issue {
  template: string;
  level: 'error' | 'warning';
  message: string;
}

function findTemplatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'templates');
}

async function main() {
  const templatesDir = findTemplatesDir();
  if (!existsSync(templatesDir)) {
    process.stderr.write(`templates dir not found: ${templatesDir}\n`);
    process.exit(1);
  }

  const entries = await readdir(templatesDir, { withFileTypes: true });
  const issues: Issue[] = [];
  let checked = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(templatesDir, entry.name);
    const yamlPath = join(dir, 'template.html-video.yaml');
    if (!existsSync(yamlPath)) {
      issues.push({
        template: entry.name,
        level: 'warning',
        message: 'missing template.html-video.yaml',
      });
      continue;
    }
    checked++;
    const raw = await readFile(yamlPath, 'utf8');
    let meta: Record<string, unknown>;
    try {
      meta = parseYaml(raw) as Record<string, unknown>;
    } catch (err) {
      issues.push({
        template: entry.name,
        level: 'error',
        message: `YAML parse error: ${err instanceof Error ? err.message : err}`,
      });
      continue;
    }

    if (meta.id !== entry.name) {
      issues.push({
        template: entry.name,
        level: 'error',
        message: `id "${String(meta.id)}" does not match directory name "${entry.name}"`,
      });
    }

    const sourceEntry = meta.source_entry as string | undefined;
    if (!sourceEntry) {
      issues.push({ template: entry.name, level: 'error', message: 'missing source_entry' });
    } else if (!existsSync(join(dir, sourceEntry))) {
      issues.push({
        template: entry.name,
        level: 'error',
        message: `source_entry not found: ${sourceEntry}`,
      });
    }

    const prov = meta.provenance as Record<string, unknown> | undefined;
    if (!prov) {
      issues.push({
        template: entry.name,
        level: 'error',
        message: 'missing provenance block (RFC-07 required)',
      });
    } else {
      if (!prov.origin) {
        issues.push({ template: entry.name, level: 'error', message: 'provenance.origin missing' });
      }
      if (!prov.transformation) {
        issues.push({
          template: entry.name,
          level: 'error',
          message: 'provenance.transformation missing',
        });
      }
      if (prov.inspired_by) {
        issues.push({
          template: entry.name,
          level: 'error',
          message:
            'legacy provenance.inspired_by still present — migrate to origin/via_skill/transformation',
        });
      }
    }

    const posterRel =
      typeof (meta.preview as { poster?: string } | undefined)?.poster === 'string'
        ? (meta.preview as { poster: string }).poster
        : 'preview.png';
    const posterPath = join(dir, posterRel);
    if (!existsSync(posterPath)) {
      issues.push({
        template: entry.name,
        level: 'warning',
        message: `missing preview poster: ${posterRel}`,
      });
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  for (const i of issues) {
    const tag = i.level === 'error' ? '✘' : '⚠';
    process.stdout.write(`${tag} ${i.template}: ${i.message}\n`);
  }

  process.stdout.write(
    `\n${checked} template(s) checked — ${errors.length} error(s), ${warnings.length} warning(s)\n`,
  );

  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
