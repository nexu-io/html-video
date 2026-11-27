import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { TemplateRef, ValidationError, ValidationResult } from '@html-video/core';

/**
 * Validate a template against the Remotion adapter. Cheap & read-only (RFC-01):
 * no bundling, no model calls — just engine match + source existence + a soft
 * note when the optional Remotion peer deps aren't installed yet.
 *
 * Phase 1: a template's `sourcePath` is an HTML frame the bridge renders. The
 * `engine` field may be 'remotion' (native, Phase 2) or 'hyperframes' (an HTML
 * frame the user explicitly chose to render through Remotion) — accept both so
 * the bridge can take any HTML frame.
 */
export function validate(template: TemplateRef): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (template.engine !== 'remotion' && template.engine !== 'hyperframes') {
    errors.push({
      code: 'engine-mismatch',
      message: `Template engine "${template.engine}" cannot be rendered by the Remotion adapter`,
      fix: `Use the @html-video/adapter-${template.engine} adapter instead`,
    });
    return { ok: false, errors, warnings };
  }

  if (!template.sourcePath) {
    errors.push({ code: 'missing-source', message: 'Template has no sourcePath' });
  } else if (!isRegularFile(template.sourcePath)) {
    errors.push({
      code: 'source-not-found',
      message: `Template source not found (or not a regular file): ${template.sourcePath}`,
      fix: 'Check that the template directory contains the file declared in source_entry',
    });
  }

  // Soft signal — render() will fail clearly if the peer deps are truly missing,
  // but flag it early so `doctor` / the agent can prompt an install.
  if (!remotionInstalled()) {
    warnings.push({
      code: 'engine-not-installed',
      message: 'Remotion peer dependencies are not installed',
      fix: 'Run `pnpm add remotion @remotion/bundler @remotion/renderer react react-dom` in the workspace root',
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** existsSync() is true for directories too — rendering needs a real file. */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Best-effort, synchronous check that the Remotion renderer can be resolved. */
export function remotionInstalled(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve('@remotion/renderer');
    req.resolve('@remotion/bundler');
    return true;
  } catch {
    return false;
  }
}
