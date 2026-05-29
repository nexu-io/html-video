/**
 * Anthropic Messages API (HTTP) agent.
 *
 * Bypasses the `claude --print` CLI entirely — that interface has a
 * non-deterministic "silently return 1 byte" failure mode on long creative
 * outputs (verified by hand on Joey's machine). Talking to the Messages API
 * directly is reliable and stream-friendly.
 *
 * Auth resolution (first match wins):
 *   1. ANTHROPIC_API_KEY        (canonical)
 *   2. ANTHROPIC_AUTH_TOKEN     (Joey's OpenRouter routing setup)
 *
 * Base URL:
 *   ANTHROPIC_BASE_URL or default https://api.anthropic.com
 *   When OpenRouter is in use, ANTHROPIC_BASE_URL is set to
 *   https://openrouter.ai/api — the OpenRouter shim accepts the standard
 *   Anthropic Messages payload + bare model names (claude-sonnet-4-6 etc).
 *
 * Model: claude-sonnet-4-6 by default. Sonnet 4.6 strikes the best balance
 * of speed / creativity / instruction-following for our HTML output;
 * upgradable per-call later if needed.
 */
import type { AgentDef, AgentEvent } from '../types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_BASE = 'https://api.anthropic.com';
const HV_MODEL_ENV = 'HV_AGENT_MODEL';

function resolveAuth(): { token: string; baseUrl: string; model: string } | null {
  const token = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
  if (!token) return null;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env[HV_MODEL_ENV] || DEFAULT_MODEL;
  return { token, baseUrl, model };
}

export const anthropicApi: AgentDef = {
  id: 'anthropic-api',
  name: 'Anthropic API (direct)',
  bin: 'anthropic-api',
  versionArgs: [],
  buildArgs: () => [],
  streamFormat: 'plain',
  kind: 'http',
  installUrl: 'https://docs.claude.com/en/api/getting-started',

  async httpProbe() {
    const auth = resolveAuth();
    if (!auth) {
      return {
        available: false,
        hint: 'Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN). For OpenRouter routing also set ANTHROPIC_BASE_URL=https://openrouter.ai/api.',
      };
    }
    return {
      available: true,
      version: `${auth.model} via ${new URL(auth.baseUrl).host}`,
    };
  },

  async httpHandler(prompt, _ctx, onEvent, signal) {
    const auth = resolveAuth();
    if (!auth) {
      onEvent({ type: 'error', message: 'No ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in env' });
      return { exitCode: -1 };
    }

    // OpenRouter expects bearer tokens via Authorization. The Anthropic
    // direct API uses x-api-key. We try x-api-key first (works on both)
    // and let the host respond. OpenRouter accepts x-api-key too.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': auth.token,
      authorization: `Bearer ${auth.token}`,
    };

    const url = `${auth.baseUrl}/v1/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: auth.model,
          max_tokens: 16000,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'error', message: `fetch failed: ${msg}` });
      return { exitCode: -1 };
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      onEvent({
        type: 'error',
        message: `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 400)}` : ''}`,
      });
      return { exitCode: -1 };
    }

    // Anthropic SSE format: event: <type>\ndata: <json>\n\n
    // Events we care about:
    //   content_block_delta { delta: { type: 'text_delta', text } } → emit text
    //   message_stop                                                → done
    //   error                                                       → emit error
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          let dataLine = '';
          for (const line of ev.split('\n')) {
            if (line.startsWith('data:')) dataLine = line.slice(5).trim();
          }
          if (!dataLine || dataLine === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataLine) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
              onEvent({ type: 'text', chunk: parsed.delta.text });
            } else if (parsed.type === 'error' && parsed.error?.message) {
              onEvent({ type: 'error', message: parsed.error.message });
            }
            // ignore message_start / content_block_start / message_delta / ping etc
          } catch {
            /* malformed line — skip */
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // AbortError is expected when the user cancels; don't log it as a hard error
      if (msg !== 'BodyStreamBuffer was aborted' && !msg.includes('aborted')) {
        onEvent({ type: 'error', message: `stream read failed: ${msg}` });
      }
      return { exitCode: -1 };
    }
    return { exitCode: 0 };
  },
};
