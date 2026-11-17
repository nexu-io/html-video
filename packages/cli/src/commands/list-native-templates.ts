import type { CliContext } from '../context.js';
import { ok } from '../output.js';

/** List native Remotion templates available for `project-enhance-frame`. */
export async function listNativeTemplates(ctx: CliContext): Promise<void> {
  const templates = ctx.templates.listNative();
  ok({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      composition_id: t.native?.compositionId,
      category: t.category,
      subcategory: t.subcategory,
      tags: t.tags,
      best_for: t.best_for,
      preview_poster: t.preview?.poster,
    })),
    default_id: templates.some((t) => t.id === 'frame-data-rollup')
      ? 'frame-data-rollup'
      : (templates[0]?.id ?? null),
  });
}
