import type { AgentDef } from '../types.js';
import { discoverOpenCodeModels } from '../models.js';

/**
 * OpenCode def (`opencode`, by SST — sst/opencode, npm `opencode-ai`).
 *
 * Unlike the `--print`-style CLIs, OpenCode's non-interactive entry is the
 * `run` SUBCOMMAND, not a flag. `opencode run` takes the message as a
 * positional arg or on stdin (non-TTY stdin is prepended to the prompt), runs
 * the session, and exits when idle. We pipe the prompt via stdin.
 *
 * Output: default stdout is an event-stream of text (not JSON unless you pass
 * `--format json`), so plain mode captures it and the extractor reads the
 * fenced ```html``` block.
 *
 * Note: in non-interactive mode OpenCode tightens permissions by default
 * (question/plan: deny). Our chat-to-HTML flow only needs the model to emit
 * text + an html block — no file edits — so the default is fine. If a future
 * mode needs the agent to write files, add `--dangerously-skip-permissions`.
 */
export const opencode: AgentDef = {
  id: 'opencode',
  name: 'OpenCode',
  bin: 'opencode',
  versionArgs: ['--version'],
  buildArgs(_prompt, ctx) {
    // `run` is the headless subcommand; prompt arrives via stdin.
    return ctx.model ? ['run', '--model', ctx.model] : ['run'];
  },
  supportsModelSelection: true,
  discoverModels: discoverOpenCodeModels,
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://opencode.ai/docs',
};
