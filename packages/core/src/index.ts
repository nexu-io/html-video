/**
 * @html-video/core — Public API surface.
 */

export * from './types/index.js';
export { HtmlVideoError } from './errors.js';
export type { ErrorCode } from './errors.js';
export { AssetStore } from './asset-store.js';
export type { AssetStoreOptions } from './asset-store.js';
export { EngineRegistry, TemplateRegistry, ProjectStore } from './registry.js';
export {
  FRAME_DURATION_MAX_SEC,
  FRAME_DURATION_MIN_SEC,
  applyFrameDuration,
  clampFrameDurationSec,
  reorderContentGraph,
  reorderFrameRecords,
} from './frame-pacing.js';
export { buildConcatFfmpegPlan, needsConcatReencode } from './frame-concat.js';
export type { ConcatFfmpegPlan } from './frame-concat.js';
export {
  frameCachePath,
  frameRenderFingerprint,
  isForceRerender,
  planFrameRender,
  shouldReuseFrameRender,
} from './frame-cache.js';
export type { FrameFingerprintInput } from './frame-cache.js';
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
