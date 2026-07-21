import type { AgentDef } from '../types.js';
import { discoverGrokModels } from '../models.js';

/**
 * Grok Build def (`grok`, by xAI — x.ai/cli; OD labels it "Grok Build (xAI)").
 *
 * This is xAI's OFFICIAL CLI, not the community `superagent-ai/grok-cli`.
 * Confirmed locally against grok 0.1.212 (`grok --help`, 2026-06-04):
 *   -p, --single <PROMPT>   "Single-turn prompt. Prints the response to
 *                            stdout and exits"  ← exactly our headless path
 *   --output-format <fmt>   [default: plain]  (plain | json | streaming-json)
 *   -v, --version
 * Prompt is an argv value of `-p` (no stdin pipe option), so it goes into
 * buildArgs and promptViaStdin stays off — same shape as hermes/aider.
 *
 * Default output is plain text, which the studio extractor reads for the
 * fenced ```html``` block.
 *
 * Note: Grok Build is early beta and gated behind SuperGrok / X Premium+ —
 * detection finds the bin, but an un-signed-in user gets an OAuth prompt on
 * first run (surfaced in chat).
 */
export const grok: AgentDef = {
  id: 'grok',
  name: 'Grok Build (xAI)',
  bin: 'grok',
  versionArgs: ['--version'],
  buildArgs(prompt, ctx) {
    // -p/--single: single-turn headless; prompt is the argv value.
    return ctx.model ? ['--model', ctx.model, '-p', prompt] : ['-p', prompt];
  },
  supportsModelSelection: true,
  discoverModels: discoverGrokModels,
  streamFormat: 'plain',
  installUrl: 'https://x.ai/cli',
};
