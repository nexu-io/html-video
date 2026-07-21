import type { AgentDef } from '../types.js';

/**
 * Qwen Code def (`qwen`, by Alibaba — QwenLM/qwen-code).
 *
 * Qwen Code is a fork of Gemini CLI, so the headless contract matches: piping
 * a prompt on stdin to a non-TTY invocation runs it once and exits, default
 * stdout is free-form text. We stay in plain mode and read the fenced
 * ```html``` block from the output.
 *
 * bin is `qwen` (npm `@qwen-code/qwen-code`), NOT `gemini`.
 */
export const qwen: AgentDef = {
  id: 'qwen',
  name: 'Qwen Code',
  bin: 'qwen',
  versionArgs: ['--version'],
  buildArgs(_prompt, ctx) {
    // Prompt via stdin; headless one-shot needs no extra args (same as Gemini CLI).
    return ctx.model ? ['--model', ctx.model] : [];
  },
  supportsModelSelection: true,
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://github.com/QwenLM/qwen-code',
};
