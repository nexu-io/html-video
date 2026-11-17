/**
 * @html-video/core type definitions
 * Implements RFC-01 (engine adapter) + RFC-02 (template metadata) + RFC-05 (project-centric workflow).
 * See research/2026-05-{26,27}-spec-{01,02,05}-*.md.
 *
 * NOTE: Storyboard / Scene types from RFC-04 were removed in v0.1
 * after Joey's product clarification — see RFC-05.
 */

// ============================================================================
// RFC-01: Engine Adapter
// ============================================================================

export type EngineId = string;

export type Paradigm =
  | 'html-css-gsap'
  | 'react-tsx'
  | 'ts-generator'
  | 'json-scene'
  | 'imperative-canvas';

export type OutputFormat = 'mp4' | 'webm' | 'webm-alpha' | 'gif' | 'png-sequence' | 'apng';

export type RenderTarget = 'local-chromium' | 'local-canvas' | 'lambda' | 'cloud-run';

export type LicensingTier = 'free-osi' | 'commercial-restricted' | 'unknown';

export interface RenderSpeedHint {
  resolution: string;
  durationSec: number;
  fps: number;
  estimatedRenderSec: number;
}

export interface EngineCapabilities {
  paradigms: Paradigm[];
  outputFormats: OutputFormat[];
  maxResolution: { width: number; height: number };
  alpha: boolean;
  audio: 'none' | 'single' | 'multi';
  subtitles: ('none' | 'burn-in' | 'sidecar')[];
  renderTarget: RenderTarget[];
  licensing: LicensingTier;
  renderSpeedHint?: RenderSpeedHint;
  bestFor: string[];
  weaknesses: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  fix?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface RenderConfig {
  format: OutputFormat;
  resolution: { width: number; height: number };
  fps: number;
  duration: number | 'auto';
  /**
   * How to treat `duration`. 'explicit' = the user set a per-frame length; it is
   * a hard cap, do NOT extend the recording to fit a longer animation. 'auto'
   * (default) = a fallback the renderer may extend so an opening animation isn't
   * cut mid-play. Multi-frame export sets 'explicit' (the format card collected a
   * real per-frame value); single-frame fast preview leaves it 'auto'.
   */
  durationMode?: 'explicit' | 'auto';
  outputPath: string;
  alpha?: boolean;
  quality?: number | 'low' | 'medium' | 'high' | 'lossless';
  audio?: { path: string; volumeDb?: number }[];
}

export interface RenderInput {
  template: TemplateRef;
  variables: Record<string, unknown>;
  config: RenderConfig;
}

export interface RenderContext {
  workDir: string;
  onProgress?: (pct: number, stage: string) => void;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export interface RenderOutput {
  outputPath: string;
  meta: {
    durationSec: number;
    fileSizeBytes: number;
    actualResolution: { width: number; height: number };
    fps: number;
    renderedFrames: number;
    renderWallClockSec: number;
    engineVersion: string;
  };
  diagnostics: string[];
}

export interface PreviewContext {
  workDir: string;
  hostname?: string;
  port?: number;
}

export interface PreviewHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface NativeTemplateRef {
  nativeId: string;
  path: string;
  hints?: { name?: string; description?: string; bestFor?: string[] };
}

export interface HtmlSceneOutput {
  htmlPath: string;
  referencedAssets: { assetId: string; usagePath: string }[];
  posterPath: string;
  durationSec: number;
}

export interface EngineAdapter {
  id: EngineId;
  name: string;
  upstreamVersion: string;
  capabilities: EngineCapabilities;

  validate(template: TemplateRef): ValidationResult;
  render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput>;
  preview?(template: TemplateRef, ctx: PreviewContext): Promise<PreviewHandle>;
  renderToHtml?(input: RenderInput, ctx: RenderContext): Promise<HtmlSceneOutput>;
  listNativeTemplates?(): Promise<NativeTemplateRef[]>;
}

// ============================================================================
// RFC-02: Template Metadata
// ============================================================================

export type TemplateCategory =
  | 'data-viz'
  | 'social-shorts'
  | 'product-demo'
  | 'explainer'
  | 'marketing'
  | 'intro-outro'
  | 'ambient'
  | 'documentary'
  | 'presentation'
  | 'transition';

export interface OutputCapabilities {
  formats: OutputFormat[];
  default_format: OutputFormat;
  resolution: {
    default: { width: number; height: number };
    supported_aspects: string[];
  };
  fps: { default: number; supported: number[] };
  duration: {
    type: 'variable' | 'fixed';
    min_sec: number;
    max_sec: number;
  };
  alpha: boolean;
  audio: { supported: boolean; expected_inputs?: string[] };
}

export interface LicenseInfo {
  spdx: string;
  attribution_required: boolean;
  redistribution_allowed: boolean;
  commercial_use: boolean;
  notes?: string | null;
}

export interface AssetAttribution {
  name: string;
  license: string;
  author?: string;
  url?: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

export interface PerformanceRef {
  duration_sec: number;
  render_wall_clock_sec: number;
  machine: string;
}

/**
 * Three-layer provenance (RFC-07). Records where a template's design actually
 * came from so the studio can surface honest attribution:
 *  - origin     — L1: the real-world design inspiration (a studio, person, or
 *                 movement). `name: 'none'` / `kind: 'none'` when there is no
 *                 specific upstream source (e.g. an original skill preset).
 *  - via_skill  — L2: the open-source skill we actually transformed from; its
 *                 license governs redistribution. author = the real copyright
 *                 holder verified against the upstream LICENSE.
 *  - transformation — L3: what html-video changed (free-text).
 */
export interface ProvenanceOrigin {
  name: string;
  kind?: 'studio' | 'person' | 'movement' | 'none';
  reference?: string;
}
export interface ProvenanceViaSkill {
  name: string;
  author?: string;
  url?: string;
  license?: string;
  source_file?: string;
}
export interface Provenance {
  origin?: ProvenanceOrigin;
  via_skill?: ProvenanceViaSkill;
  transformation?: string;
}

export interface TemplateMetadata {
  spec_version: 1;
  id: string;
  name: string;
  description: string;
  engine: EngineId;
  engine_version: string;
  source_entry: string;
  /**
   * Native-engine templates (RFC-08 Phase 2): `source_entry` is a bundle entry
   * (e.g. a Remotion `entry.ts` calling `registerRoot`) rather than an HTML
   * file. `compositionId` is the `<Composition id>` the adapter selects. Absent
   * for the classic HTML+CSS+GSAP templates (the 27 hyperframes ones).
   */
  native?: { compositionId: string };
  category: TemplateCategory;
  subcategory?: string;
  tags: string[];
  best_for: string[];
  not_for?: string[];
  output: OutputCapabilities;
  inputs: { schema: object; examples: object[] };
  license: LicenseInfo;
  /** Three-layer design attribution (RFC-07). See {@link Provenance}. */
  provenance?: Provenance;
  assets_attribution?: AssetAttribution[];
  author: { name: string; url?: string; contact?: string };
  maintainers?: { github: string }[];
  contributing?: { url: string };
  version: string;
  changelog?: ChangelogEntry[];
  preview: { poster: string; loop?: string; thumbnail?: string };
  performance?: { reference_render: PerformanceRef };
  share_optimized_for?: string[];
  /** Internal: filesystem location of the template directory (set by registry) */
  __dir?: string;
}

export interface TemplateRef {
  id: string;
  engine: EngineId;
  /** Bridge mode: an HTML file. Native mode: a Remotion .tsx bundle entry. */
  sourcePath: string;
  variables?: Record<string, unknown>;
  /**
   * How the engine should consume `sourcePath`. Absent ⇒ 'bridge' (the legacy
   * path: render the given HTML). 'native' ⇒ the engine bundles `sourcePath` as
   * its own component entry and renders `nativeCompositionId` directly (e.g. a
   * Remotion React-tsx data-animation template fed real data via `variables`).
   * Only the Remotion adapter honors 'native' today (RFC-08 Phase 2).
   */
  mode?: 'bridge' | 'native';
  /** Native mode only: the Remotion `<Composition id>` to select after bundling. */
  nativeCompositionId?: string;
}

// ============================================================================
// RFC-05: Project-centric workflow
// ============================================================================

export type AssetType = 'image' | 'text' | 'data' | 'audio' | 'video' | 'reference-link';

export interface Asset {
  id: string;
  type: AssetType;
  path?: string;
  content?: string;
  metadata: {
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    durationSec?: number;
    userCaption?: string;
  };
  userTags: string[];
}

export interface UserPreferences {
  aspect?: string;
  durationTargetSec?: number;
  format?: 'mp4' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
  mood?: string;
  brandColors?: string[];
  fontFamilies?: string[];
  language?: string;
  commercial?: boolean;
}

export type ProjectStatus = 'draft' | 'previewed' | 'rendered';

/**
 * v0.8: a single rendered HTML frame in a multi-frame project.
 * Maps 1:1 to a node in the project's contentGraph (graphNodeId).
 */
export interface FrameRecord {
  /** Stable id, mirrors the graph node id */
  graphNodeId: string;
  /** Absolute path to the rendered HTML file (e.g. .../frames/01-intro.html) */
  htmlPath: string;
  /** Playback duration for this frame, seconds */
  durationSec: number;
  /** Optional poster image (first-frame thumbnail) */
  posterPath?: string;
  /** 0-based index in topo-sorted play order */
  order: number;
  /**
   * Per-frame engine override (RFC-08/09). Absent ⇒ inherit the project's
   * template engine (hyperframes). Set to 'remotion' when the user explicitly
   * opts this frame into a native motion-enhancement. The base render at
   * `htmlPath` is always retained so toggling enhancement off is non-destructive.
   */
  engine?: EngineId;
  /**
   * When enhanced: which native template renders this frame (e.g.
   * 'frame-data-rollup'). Resolved against the TemplateRegistry at export time.
   */
  nativeTemplateId?: string;
  /**
   * When enhanced: snapshot of the source content-graph DataNode's `data`,
   * bound at enhance time and fed to the native template as inputProps. Kept on
   * the frame so export is self-contained and doesn't re-read the graph.
   */
  data?: unknown;
  /**
   * When enhanced: path to a short single-frame MP4 the studio renders so the
   * user can preview the native animation before a full export (a native frame
   * has no HTML to load in an iframe). Cleared on unenhance. Separate from the
   * export loop's `frames/NN.mp4` so the two lifecycles don't collide.
   */
  previewMp4Path?: string;

  /**
   * When set: this frame is a pre-rendered MP4 clip imported by the user
   * (not generated by an engine). References an asset in `project.assets[]`
   * with `type: 'video'`. The export loop skips adapter rendering and passes
   * the asset's file directly to ffmpeg concat. Mutually exclusive with
   * engine/nativeTemplateId/enhance fields — a clip frame has no HTML source.
   */
  clipAssetId?: string;
}

/**
 * v0.9: project-level soundtrack — one background music track + one narration
 * track mixed into the exported MP4. Both reference an entry in `assets[]`
 * (type 'audio'); this struct only holds the ids + mix preferences, so the
 * audio bytes live in the normal asset store. Per-frame audio is a v2 concern.
 */
export interface ProjectSoundtrack {
  /** asset.id of the background-music track (type 'audio'), if generated */
  musicAssetId?: string;
  /** asset.id of the narration / voiceover track, if generated */
  narrationAssetId?: string;
  /** Background-music gain in dB applied at mux time (default -18, pushed under voice) */
  musicVolumeDb?: number;
  /** Narration gain in dB (default 0) */
  narrationVolumeDb?: number;
  /** Last music style prompt used — kept so the UI can show / re-run it */
  musicPrompt?: string;
  /** Last narration text used (the stitched full script) */
  narrationText?: string;
  /** Per-frame narration: { [graphNodeId]: line }. The UI edits/shows narration
   *  per selected frame; narrationText is these stitched in frame order. */
  narrationByFrame?: Record<string, string>;
  /** Optional music fade-in seconds at the start of the video */
  fadeInSec?: number;
  /** Optional music fade-out seconds at the end of the video */
  fadeOutSec?: number;
}

/**
 * Per-segment audio status from the pre-export "every clip has audio" check.
 * A segment counts as having audio when it carries an embedded audio track
 * (imported clips only), has per-frame narration text, or the project has a
 * soundtrack (music/narration) that plays across the whole video.
 */
export interface FrameAudioStatus {
  /** graphNodeId of the frame, or 'single' for a single-frame project. */
  graphNodeId: string;
  /** 0-based play order. */
  order: number;
  /** How this segment is produced. */
  kind: 'clip' | 'generated';
  /** Human-readable label for the UI (clip filename or frame id). */
  label: string;
  /** Whether audio is available for this segment. */
  hasAudio: boolean;
  /** Which sources satisfy the audio requirement, if any. */
  sources: ('embedded' | 'narration' | 'soundtrack')[];
}

/**
 * Result of {@link ProjectOrchestrator.checkClipsAudio}. Drives the Studio
 * warn-before-export gate; it never blocks export on its own.
 */
export interface AudioCheckResult {
  /** True when every segment has audio available. */
  ok: boolean;
  /** True when the project has a background-music or narration soundtrack. */
  hasSoundtrack: boolean;
  /** Per-segment status, in play order. */
  frames: FrameAudioStatus[];
  /** Subset of `frames` with `hasAudio === false`. */
  silent: FrameAudioStatus[];
}

export interface Project {
  id: string;
  name: string;
  intent?: string;
  assets: Asset[];
  templateId: string | null;
  /** Agent runtime to use (detected agent id, e.g. "claude" / "cursor-agent"). null = default first available */
  agentId?: string | null;
  /** Model id for agents that support model selection (e.g. AMR: deepseek-v4-flash,
   *  claude-opus-4.8…). null = agent's default. */
  agentModel?: string | null;
  /**
   * Free-form variables (RFC-02 inputs.schema compatible).
   * v0.3+: deprecated as the user-facing primary surface — agents now produce HTML directly.
   * Kept for adapter render() backward compatibility (engine still expects vars).
   */
  variables: Record<string, unknown>;
  preferences: UserPreferences;
  status: ProjectStatus;
  /** Path to the latest agent-generated HTML (v0.3 chat-to-HTML pipeline; single-frame fast path) */
  lastPreviewHtmlPath?: string;
  lastPreviewPosterPath?: string;
  lastOutputMp4Path?: string;
  /** Export history — every MP4 exported for this project, newest last. Each
   *  export writes a uniquely-named file so older ones aren't overwritten. */
  exports?: Array<{ path: string; createdAt: string; filename: string }>;
  /**
   * v0.8: path to content-graph.json for multi-frame projects.
   * Absent for single-frame fast-path projects.
   */
  contentGraphPath?: string;
  /**
   * v0.8: rendered frame sequence in topo-sorted play order.
   * Empty for single-frame fast-path projects.
   */
  frames?: FrameRecord[];
  /** v0.9: optional background music + narration mixed into the export. */
  soundtrack?: ProjectSoundtrack;
  createdAt: string;
  updatedAt: string;
}
