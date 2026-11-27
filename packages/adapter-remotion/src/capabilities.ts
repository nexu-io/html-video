import type { EngineCapabilities } from '@html-video/core';

/**
 * Static capability declaration for Remotion (RFC-08 §1, cross-checked
 * 2026-06-06 against remotion@4.0.x).
 *
 * `licensing: 'commercial-restricted'` is a FIRST-CLASS field here, not a
 * footnote: Remotion is free for individuals / companies ≤3 people / non-profit,
 * but 4+ person teams pay. The agent reads this to steer "free / cheap" jobs
 * toward the free-osi engines (hyperframes / revideo) and only suggest Remotion
 * when the team already uses React or needs Lambda scale. That honesty is the
 * meta-layer's advantage over a Remotion-only tool — surface it, don't hide it.
 */
export const capabilities: EngineCapabilities = Object.freeze<EngineCapabilities>({
  // Phase 1 bridges html-css-gsap frames; Phase 2 (RFC-09) adds react-tsx natives.
  paradigms: ['react-tsx', 'html-css-gsap'],
  outputFormats: ['mp4', 'webm', 'gif', 'png-sequence'],
  // Remotion is bounded by Chrome's 2^29-px single-image cap; 8K frames are fine.
  maxResolution: { width: 7680, height: 4320 },
  alpha: true,
  audio: 'multi',
  subtitles: ['burn-in', 'sidecar'],
  // Deterministic local chromium, and one-line scale-out to Lambda / Cloud Run.
  renderTarget: ['local-chromium', 'lambda', 'cloud-run'],
  licensing: 'commercial-restricted',
  renderSpeedHint: {
    resolution: '1080p',
    durationSec: 10,
    fps: 30,
    // Deterministic frame-by-frame is slower than realtime screen capture but
    // never drops frames; rough order-of-magnitude only.
    estimatedRenderSec: 40,
  },
  bestFor: [
    'data-driven',
    'long-form-narration',
    'spring-physics',
    'parametric-batch',
    'lambda-scale',
    'react-ecosystem',
  ],
  weaknesses: [
    'commercial-license-for-teams',
    'slower-than-realtime-capture',
    'bundle-overhead',
    'css-gsap-needs-time-driver-bridge',
  ],
});
