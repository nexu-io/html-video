export type {
  AgentDef,
  AgentInvokeContext,
  DetectedAgent,
  AgentEvent,
  SpawnHandle,
  ModelAvailability,
  ModelOption,
  ModelCatalogStatus,
  ModelCatalog,
  ModelDiscoveryContext,
  ModelDiscoveryResult,
} from './types.js';
export { AGENT_DEFS, findAgent } from './registry.js';
export { detectOne, detectAll, resolveBin } from './detect.js';
export { spawnAgent } from './spawn.js';
export type { SpawnOptions } from './spawn.js';
export {
  discoverAgentModels,
  discoverAnthropicApiModels,
  discoverCodexModels,
  discoverGrokModels,
  discoverCursorModels,
  discoverOpenCodeModels,
  discoverAiderModels,
  discoverCopilotModels,
  parseModelLines,
  parseModelPayload,
  parseCopilotHelpModels,
  isValidModelId,
} from './models.js';
