import type { AgentDef } from '../types.js';
import { discoverAiderModels } from '../models.js';

/**
 * Aider def (`aider`, by Aider-AI — aider-ai/aider, Python pair-programmer).
 *
 * Aider does NOT read its prompt from stdin — the one-shot entry is the
 * `-m`/`--message` argv flag (send one message, process, exit). So the prompt
 * goes into argv (same shape as the hermes def), with promptViaStdin left off.
 *
 * Scripting flags:
 *   --yes-always   auto-confirm "Add file to chat?" etc., else it can stall
 *                  even with -m (long-standing behaviour).
 *   --no-pretty    drop ANSI colour/markup so stdout is clean text.
 *   --no-stream    emit the full reply at once rather than token-streaming.
 * Default output is human-readable text (no JSON), so plain mode reads the
 * fenced ```html``` block.
 */
export const aider: AgentDef = {
  id: 'aider',
  name: 'Aider',
  bin: 'aider',
  versionArgs: ['--version'],
  buildArgs(prompt, ctx) {
    // argv-only prompt (Aider has no stdin prompt path).
    const args = ['--yes-always', '--no-pretty', '--no-stream', '--message', prompt];
    return ctx.model ? [...args, '--model', ctx.model] : args;
  },
  supportsModelSelection: true,
  discoverModels: discoverAiderModels,
  streamFormat: 'plain',
  installUrl: 'https://aider.chat/docs/scripting.html',
};
