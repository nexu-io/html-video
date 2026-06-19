import type { AgentDef } from '../types.js';

/**
 * CodeBuddy CLI def (`codebuddy`, by Tencent — npm `@tencent-ai/codebuddy-code`).
 *
 * CodeBuddy Code is a terminal-based AI coding agent in the claude-code family;
 * it ships as a single `codebuddy` binary (npm-installed globally, or via the
 * `Tencent-CodeBuddy/tap` Homebrew tap). The headless contract is the same shape
 * as Claude Code / Cursor Agent / Codex / Qoder — single-shot prompt → single
 * stdout reply, no interactive UI.
 *
 * Headless contract (per CodeBuddy CLI Reference, codebuddy.ai/docs/cli/headless):
 *   echo "<prompt>" | codebuddy -p --dangerously-skip-permissions
 *
 *   -p / --print  →  "Print response and exit (for piping). Non-interactive."
 *   --dangerously-skip-permissions  →  required when -p needs to invoke tools
 *     that ask for permission (file edits, network, shell). The official docs
 *     state: "when using -p/--print, if the model needs to call tools that
 *     require authorization (file ops, network, etc.), --dangerously-skip-
 *     permissions MUST be specified explicitly, otherwise the permission check
 *     will block the run." A studio session can never answer that prompt.
 *
 * Prompt is passed via stdin (promptViaStdin: true). Two reasons:
 *   1. spawn.ts pipes the prompt straight into child.stdin — no shell-escaping
 *      issues with CJK chars, backticks, quotes, or long article bodies.
 *   2. CodeBuddy reads piped input as the prompt automatically (claude-code
 *      family convention), so we do NOT need a `-` placeholder after `-p`
 *      (Qoder requires `-p -`; CodeBuddy / Claude / Cursor do not).
 *
 * Default stdout is plain text, so the studio's fenced ```html``` block
 * extractor handles output without an NDJSON parser. CodeBuddy also supports
 * `--output-format json|stream-json`; we keep plain to stay aligned with the
 * rest of the claude-code-family agents and avoid an extra parsing path.
 *
 * Version probe: `codebuddy --version` → e.g. "0.x.y" (commander-style; the
 * CLI Reference lists `-V, --version` and the install docs use `--version`).
 *
 * Install: https://www.npmjs.com/package/@tencent-ai/codebuddy-code
 *   npm install -g @tencent-ai/codebuddy-code   (Node.js ≥ 18.20)
 *   brew install Tencent-CodeBuddy/tap/codebuddy-code   (no Node required)
 */
export const codebuddyCli: AgentDef = {
  id: 'codebuddy',
  name: 'CodeBuddy CLI',
  bin: 'codebuddy',
  versionArgs: ['--version'],
  buildArgs(_prompt, _ctx) {
    // -p: non-interactive, print response and exit (prompt comes via stdin).
    // --dangerously-skip-permissions: auto-approve tool calls so a studio run
    //   never blocks on the interactive permission prompt the headless mode
    //   cannot answer (mandated by CodeBuddy when -p needs tool access).
    return ['-p', '--dangerously-skip-permissions'];
  },
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://www.npmjs.com/package/@tencent-ai/codebuddy-code',
};
