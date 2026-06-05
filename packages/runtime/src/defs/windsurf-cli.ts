import type { AgentDef } from '../types.js';

/**
 * Windsurf CLI public ACP adapter (Codeium).
 *
 * html-video runs agent CLIs from the local studio/CLI process without a TTY.
 * Windsurf's ACP server therefore has to start in yolo mode so tool calls do not
 * block forever behind an interactive permission prompt the studio cannot
 * answer.
 */
export const windsurfCli: AgentDef = {
  id: 'windsurf-cli',
  name: 'Windsurf CLI',
  bin: 'windsurf',
  versionArgs: ['--version'],
  buildArgs() {
    return ['--yolo'];
  },
  streamFormat: 'acp-json-rpc',
  installUrl: 'https://docs.windsurf.com/windsurf/getting-started',
};
