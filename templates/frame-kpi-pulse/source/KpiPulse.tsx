// frame-kpi-pulse — native Remotion single-metric hero (RFC-08 Phase 2 expand).
//
// Not a chart: one number springs in, counts 0→target, with a soft accent ring
// pulse. Opt-in enhance for data frames that are a single KPI rather than a series.
// System fonts only — offline-deterministic, no network.
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export interface KpiPulseProps {
  data: {
    title?: string;
    label?: string;
    caption?: string;
    unit?: string;
    value: number;
    /** Optional series fallback — first / max item used if value absent at normalize time. */
    items?: Array<{ label: string; value: number }>;
  };
  accent?: string;
  background?: string;
  foreground?: string;
}

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const DEFAULTS = {
  accent: '#3CE6AC',
  background: '#0B0F14',
  foreground: '#F4F7FA',
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export const KpiPulse: React.FC<KpiPulseProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = props.data ?? { value: 0 };
  const value = Number.isFinite(data.value) ? data.value : 0;
  const accent = props.accent ?? DEFAULTS.accent;
  const background = props.background ?? DEFAULTS.background;
  const foreground = props.foreground ?? DEFAULTS.foreground;
  const unit = data.unit ?? '';
  const label = data.label ?? data.items?.[0]?.label ?? '';
  const title = data.title;
  const caption = data.caption;

  const enter = spring({
    frame,
    fps,
    config: { damping: 16, mass: 0.85, stiffness: 120 },
  });
  const scale = interpolate(enter, [0, 1], [0.72, 1]);
  const rolled = value * enter;

  // Soft ring: expands then settles opacity.
  const ring = spring({
    frame: frame - Math.round(fps * 0.08),
    fps,
    config: { damping: 18, stiffness: 80 },
  });
  const ringScale = interpolate(ring, [0, 1], [0.55, 1.08]);
  const ringOpacity = interpolate(ring, [0, 0.5, 1], [0, 0.45, 0.22], {
    extrapolateRight: 'clamp',
  });

  const titleOp = interpolate(enter, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' });
  const captionOp = interpolate(enter, [0.35, 1], [0, 0.75], { extrapolateRight: 'clamp' });

  const numSize = Math.round(Math.min(width, height) * 0.22);
  const ringSize = Math.round(Math.min(width, height) * 0.55);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: background,
        fontFamily: SYSTEM_SANS,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.12),
            left: Math.round(width * 0.08),
            right: Math.round(width * 0.08),
            textAlign: 'center',
            color: foreground,
            fontSize: Math.round(height * 0.038),
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            opacity: titleOp,
          }}
        >
          {title}
        </div>
      ) : null}

      <div
        style={{
          position: 'relative',
          width: ringSize,
          height: ringSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${scale})`,
          opacity: enter,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `3px solid ${accent}`,
            transform: `scale(${ringScale})`,
            opacity: ringOpacity,
          }}
        />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <div
            style={{
              color: accent,
              fontFamily: SYSTEM_MONO,
              fontSize: numSize,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1,
            }}
          >
            {fmt(rolled)}
            {unit ? (
              <span style={{ fontSize: numSize * 0.35, marginLeft: 8, fontWeight: 600 }}>
                {unit}
              </span>
            ) : null}
          </div>
          {label ? (
            <div
              style={{
                marginTop: Math.round(height * 0.025),
                color: foreground,
                fontSize: Math.round(height * 0.036),
                fontWeight: 500,
                opacity: 0.9,
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
      </div>

      {caption ? (
        <div
          style={{
            position: 'absolute',
            bottom: Math.round(height * 0.12),
            left: Math.round(width * 0.12),
            right: Math.round(width * 0.12),
            textAlign: 'center',
            color: foreground,
            fontSize: Math.round(height * 0.028),
            fontWeight: 400,
            lineHeight: 1.45,
            opacity: captionOp,
          }}
        >
          {caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
