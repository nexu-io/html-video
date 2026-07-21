import type { AgentDef } from '../types.js';
import { discoverAcpModels } from '../acp-client.js';

/**
 * Trae CLI public ACP adapter.
 *
 * html-video runs agent CLIs from the local studio/CLI process without a TTY.
 * Trae's ACP server therefore has to start in yolo mode so tool calls do not
 * block forever behind an interactive permission prompt the studio cannot
 * answer.
 */
export const traeCli: AgentDef = {
  id: 'trae-cli',
  name: 'Trae CLI',
  bin: 'traecli',
  versionArgs: ['--version'],
  buildArgs() {
    return ['acp', 'serve', '--yolo'];
  },
  supportsModelSelection: true,
  async discoverModels(ctx) {
    if (!ctx.bin) throw new Error('Trae CLI executable was not resolved.');
    return await discoverAcpModels({
      bin: ctx.bin,
      args: ['acp', 'serve', '--yolo'],
      cwd: ctx.cwd,
      ...(ctx.signal && { signal: ctx.signal }),
    });
  },
  streamFormat: 'acp-json-rpc',
  installUrl: 'https://www.volcengine.com/docs/86677/2227861?lang=zh',
};
