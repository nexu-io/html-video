import type { AgentDef } from '../types.js';

/**
 * Devin CLI public ACP adapter (Cognition / formerly Windsurf).
 *
 * html-video runs agent CLIs from the local studio/CLI process without a TTY.
 * `devin acp` starts Devin as an ACP JSON-RPC server over stdio so tool calls
 * are driven by the ACP client rather than an interactive terminal session.
 *
 * Requires: `devin auth login` completed at least once (credentials stored
 * in the Devin config directory). Alternatively set WINDSURF_API_KEY in the
 * environment before launching the studio.
 */
export const devinCli: AgentDef = {
  id: 'devin-cli',
  name: 'Devin CLI',
  bin: 'devin',
  versionArgs: ['--version'],
  buildArgs() {
    return ['acp'];
  },
  streamFormat: 'acp-json-rpc',
  installUrl: 'https://cli.devin.ai',
};
