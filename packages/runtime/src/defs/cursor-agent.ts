import type { AgentDef } from '../types.js';
import { discoverCursorModels } from '../models.js';

export const cursorAgent: AgentDef = {
  id: 'cursor-agent',
  name: 'Cursor Agent',
  bin: 'cursor-agent',
  versionArgs: ['--version'],
  buildArgs(_prompt, ctx) {
    return ctx.model ? ['--print', '--model', ctx.model] : ['--print'];
  },
  supportsModelSelection: true,
  discoverModels: discoverCursorModels,
  streamFormat: 'plain',
  promptViaStdin: true,
  installUrl: 'https://cursor.com/cli',
};
