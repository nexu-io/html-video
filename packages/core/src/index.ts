/**
 * @html-video/core — Public API surface.
 */

export * from './types/index.js';
export { HtmlVideoError } from './errors.js';
export type { ErrorCode } from './errors.js';
export { AssetStore } from './asset-store.js';
export type { AssetStoreOptions } from './asset-store.js';
export { EngineRegistry, TemplateRegistry, ProjectStore } from './registry.js';
export { ProjectOrchestrator } from './project.js';
export type {
  CreateProjectInput,
  ProjectOrchestratorDeps,
} from './project.js';
export {
  resolveMinimaxCredentials,
  generateTts,
  generateMusic,
} from './minimax.js';
export type { MinimaxCredentials, MinimaxAudioResult } from './minimax.js';
export {
  resolveSenseAudioCredentials,
  generateTtsSenseAudio,
  listSenseAudioVoices,
} from './senseaudio.js';
export type { SenseAudioCredentials, SenseAudioVoice } from './senseaudio.js';
export type { GeneratedAudio, BearerAudioCredentials } from './audio-http.js';
