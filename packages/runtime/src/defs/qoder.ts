import type { AgentDef } from '../types.js';

/**
 * Qoder CLI def (`qodercli`, by Qoder — npm `@qoder-ai/qodercli`).
 *
 * Qoder ships two binaries: `qoder` (the IDE / Electron wrapper) and
 * `qodercli` (the standalone coding agent CLI, installed via npm).
 * html-video uses the latter — it's the headless-capable one.
 *
 * Headless contract (same shape as Claude Code / Codex / Qwen):
 *   echo "<prompt>" | qodercli -p - --permission-mode bypass_permissions
 *
 *   -p -          →  non-interactive, read prompt from stdin, print to stdout.
 *   --permission-mode bypass_permissions  →  auto-approve all tool calls
 *     (file writes, shell, etc.) so the session never blocks on an
 *     interactive permission prompt the studio cannot answer.
 *
 * Prompt is passed via stdin (promptViaStdin: true) — avoids Windows shell
 * escaping issues with backticks, quotes, and CJK chars in long prompts.
 * Default stdout is plain text, so the extractor reads the fenced ```html``` block.
 *
 * Version probe: `qodercli -v` → e.g. "1.0.14".
 */
export const qoderCli: AgentDef = {
  id: 'qoder-cli',
  name: 'Qoder CLI',
  bin: 'qodercli',
  versionArgs: ['-v'],
  buildArgs(_prompt, _ctx) {
    // -p -: read prompt from stdin (avoids Windows shell escaping issues
    //   with backticks, quotes, and other special chars in long prompts).
    // --permission-mode bypass_permissions: auto-approve tool calls.
    // --dangerously-skip-permissions: belt-and-suspenders — ensures
    //   the sandbox layer also lifts write/edit restrictions.
    return ['-p', '-', '--permission-mode', 'bypass_permissions', '--dangerously-skip-permissions'];
  },
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://www.npmjs.com/package/@qoder-ai/qodercli',
};
