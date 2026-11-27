/**
 * Stable error codes per RFC-01 + RFC-05.
 */

export type ErrorCode =
  | 'engine-not-installed'
  | 'engine-not-registered'
  | 'template-invalid'
  | 'template-not-found'
  | 'render-failed'
  | 'render-timeout'
  | 'output-corrupt'
  | 'disk-full'
  | 'cancelled'
  | 'asset-not-found'
  | 'project-not-found'
  | 'invalid-input';

export class HtmlVideoError extends Error {
  override readonly name = 'HtmlVideoError';
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    // Keep the prototype chain intact when this file is transpiled below
    // ES2015 (issue #57, finding 6): without this, `instanceof HtmlVideoError`
    // silently fails on downleveled output and callers miss the typed error.
    Object.setPrototypeOf(this, HtmlVideoError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      // `context` is caller-supplied and may hold circular refs, Buffers or
      // functions — serialisation must never blow up error logging itself
      // (issue #57, finding 15).
      context: safeSerialize(this.context),
    };
  }
}

/**
 * Serialise `context` key-by-key so one unserialisable value (circular ref,
 * function, Buffer) can't nuke the whole error payload (issue #57, finding 15).
 */
function safeSerialize(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    try {
      out[key] = JSON.parse(JSON.stringify(value));
    } catch {
      out[key] = { note: 'value omitted (not JSON-serialisable)' };
    }
  }
  return out;
}
