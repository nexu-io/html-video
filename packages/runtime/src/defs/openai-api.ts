/**
 * OpenAI-compatible Chat Completions API (HTTP) agent.
 *
 * Speaks the OpenAI /v1/chat/completions protocol, which is supported by
 * OpenAI, Groq, Together AI, Fireworks, Ollama, LM Studio, vLLM, and any
 * other OpenAI-shim provider.
 *
 * Auth resolution (first match wins):
 *   1. OPENAI_API_KEY   (canonical)
 *
 * Base URL:
 *   OPENAI_BASE_URL or default https://api.openai.com
 *   Point this at any OpenAI-compatible endpoint, e.g.:
 *     http://localhost:11434/v1  (Ollama)
 *     https://api.groq.com/openai (Groq)
 *     https://openrouter.ai/api   (OpenRouter)
 *
 * Model: gpt-4o-mini by default. Override via HV_AGENT_MODEL.
 */
import type { AgentDef, AgentEvent } from '../types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE = 'https://api.openai.com';
const HV_MODEL_ENV = 'HV_AGENT_MODEL';

function resolveAuth(): { token: string; baseUrl: string; model: string } | null {
  const token = process.env.OPENAI_API_KEY || '';
  if (!token) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env[HV_MODEL_ENV] || DEFAULT_MODEL;
  return { token, baseUrl, model };
}

export const openaiApi: AgentDef = {
  id: 'openai-api',
  name: 'OpenAI API',
  bin: 'openai-api',
  versionArgs: [],
  buildArgs: () => [],
  streamFormat: 'plain',
  kind: 'http',
  installUrl: 'https://platform.openai.com/api-keys',

  async httpProbe() {
    const auth = resolveAuth();
    if (!auth) {
      return {
        available: false,
        hint: 'Set OPENAI_API_KEY. Optionally set OPENAI_BASE_URL for Groq, Ollama, OpenRouter, etc.',
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
      onEvent({ type: 'error', message: 'No OPENAI_API_KEY in env' });
      return { exitCode: -1 };
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.token}`,
    };

    // If baseUrl already ends with a version segment (e.g. /v3, /v1), append
    // only /chat/completions. Otherwise prepend /v1 (OpenAI default convention).
    const chatPath = /\/v\d+$/.test(auth.baseUrl) ? '/chat/completions' : '/v1/chat/completions';
    const url = `${auth.baseUrl}${chatPath}`;
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

    // OpenAI SSE format: data: <json>\n\n, ends with data: [DONE]\n\n
    // Events we care about:
    //   { choices: [{ delta: { content: "..." } }] } → emit text
    //   data: [DONE]                                  → done
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
            const parsed = JSON.parse(dataLine) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
              error?: { message?: string };
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              onEvent({ type: 'text', chunk: content });
            } else if (parsed.error?.message) {
              onEvent({ type: 'error', message: parsed.error.message });
            }
          } catch {
            /* malformed line — skip */
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'BodyStreamBuffer was aborted' && !msg.includes('aborted')) {
        onEvent({ type: 'error', message: `stream read failed: ${msg}` });
      }
      return { exitCode: -1 };
    }
    return { exitCode: 0 };
  },
};
