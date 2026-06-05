/**
 * Windsurf CLI smoke tests.
 *
 * These are pure-definition tests — they verify the agent definition is
 * well-formed and will be picked up by the registry. They do NOT spawn a
 * real windsurf process (which would require an installation).
 */

import { describe, it } from 'node:test';
import { AGENT_DEFS, findAgent } from '../dist/registry.js';

describe('Windsurf CLI', () => {
  it('is registered in AGENT_DEFS', () => {
    const agent = findAgent('windsurf-cli');
    if (!agent) {
      throw new Error('windsurf-cli not found in AGENT_DEFS registry');
    }
  });

  it('has correct shape', () => {
    const agent = findAgent('windsurf-cli');
    if (!agent) throw new Error('not found');
    if (agent.id !== 'windsurf-cli') throw new Error('wrong id');
    if (agent.name !== 'Windsurf CLI') throw new Error('wrong name');
    if (agent.bin !== 'windsurf') throw new Error('wrong bin');
    if (agent.streamFormat !== 'acp-json-rpc') throw new Error('wrong streamFormat');
  });

  it('buildArgs returns yolo mode', () => {
    const agent = findAgent('windsurf-cli');
    if (!agent) throw new Error('not found');
    const args = agent.buildArgs('test prompt', { cwd: '/' });
    if (!args.includes('--yolo')) {
      throw new Error('buildArgs() should include --yolo flag');
    }
  });
});
