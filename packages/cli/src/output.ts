/**
 * JSON-first output helpers per RFC-03.
 * `--json` (default for agent) emits NDJSON-friendly single-object lines.
 * Non-JSON mode uses simple readable text.
 */

let JSON_MODE = true;

export function setJsonMode(on: boolean) {
  JSON_MODE = on;
}

export function ok(payload: unknown): void {
  if (JSON_MODE) {
    const body =
      payload != null && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : { data: payload };
    process.stdout.write(`${JSON.stringify({ ...body, status: 'ok' })}\n`);
  } else {
    process.stdout.write(`${pretty(payload)}\n`);
  }
}

export function fail(code: string, message: string, ctx: Record<string, unknown> = {}): never {
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify({ status: 'error', code, message, ...ctx })}\n`);
  } else {
    process.stderr.write(`✘ ${code}: ${message}\n`);
  }
  process.exit(1);
}

export function progress(stage: string, pct: number, extra: Record<string, unknown> = {}): void {
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify({ type: 'progress', stage, pct, ...extra })}\n`);
  } else {
    process.stdout.write(`  ${stage}: ${pct}%\n`);
  }
}

function pretty(p: unknown): string {
  if (p == null) return '(empty)';
  if (typeof p === 'string') return p;
  return JSON.stringify(p, null, 2);
}
