import type { CliContext } from '../context.js';
import { fail, ok } from '../output.js';

interface SearchOpts {
  intent?: string;
  aspect?: string;
  licenseAllow?: string;
  top?: number;
}

export async function searchTemplates(ctx: CliContext, opts: SearchOpts): Promise<void> {
  const allowed = opts.licenseAllow
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const enginesAvailable = ctx.engines.list().map((e) => e.id);
  const matches = ctx.templates.search({
    ...(opts.intent !== undefined && { intent: opts.intent }),
    ...(opts.aspect !== undefined && { aspect: opts.aspect }),
    ...(allowed && { licenseAllow: allowed }),
    enginesAvailable,
    top: opts.top ?? 5,
  });
  ok({
    matches: matches.map((m) => ({
      id: m.template.id,
      name: m.template.name,
      engine: m.template.engine,
      engine_installed: ctx.engines.has(m.template.engine),
      score: m.score,
      score_reason: m.reason,
      preview_poster: m.template.preview.poster,
      best_for: m.template.best_for,
      category: m.template.category,
      license: m.template.license.spdx,
      duration_min_sec: m.template.output.duration.min_sec,
      duration_max_sec: m.template.output.duration.max_sec,
    })),
  });
}

export async function inspectTemplate(ctx: CliContext, id: string): Promise<void> {
  if (!ctx.templates.has(id)) {
    fail('template-not-found', `Template "${id}" not found`, {
      available: ctx.templates.list().map((t) => t.id),
    });
  }
  const t = ctx.templates.get(id);
  ok({ template: t });
}
