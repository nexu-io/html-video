export type { AgentDef, AgentInvokeContext, DetectedAgent, AgentEvent, SpawnHandle } from './types.js';
export { AGENT_DEFS, findAgent } from './registry.js';
export { detectOne, detectAll, resolveBin } from './detect.js';
export { spawnAgent } from './spawn.js';
export type { SpawnOptions } from './spawn.js';
