import type { AgentDef } from '../types.js';

/**
 * Claude Code CLI def (`claude`, by Anthropic).
 * Slim version: prompt via stdin, plain text streamFormat.
 * v0.2 will switch to stream-json when we wire interactive tool_result.
 */
export const claude: AgentDef = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  versionArgs: ['--version'],
  buildArgs(_prompt, ctx) {
    // --print: non-interactive, write entire response to stdout then exit.
    // No permission-mode: chat-to-HTML never edits files; the model only emits
    // text + a fenced ```html``` block, which our extractor reads. Plan mode
    // (which we tried in v0.3) suppressed actual content.
    return ctx.model ? ['--print', '--model', ctx.model] : ['--print'];
  },
  supportsModelSelection: true,
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
};
