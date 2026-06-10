/**
 * frame-data-radar — A native Remotion radar/spider chart template.
 *
 * Animated SVG radar chart: concentric grid rings, axis lines with labels,
 * a data polygon that fills with spring physics, and a score badge per axis.
 * Pure system fonts only, no external assets.
 *
 * Adapted from Hermes Studio's SceneRadar component (KPI 5-dimension radar).
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RadarAxis {
  label: string;
  value: number;
}

export interface DataRadarData {
  title?: string;
  axes: RadarAxis[];
  /** Maximum value for the scale. Auto-computed if omitted. */
  maxValue?: number;
  /** Number of concentric grid rings. Default 4. */
  rings?: number;
}

export interface DataRadarProps {
  data: DataRadarData;
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  /**
   * Axes short of this threshold are tinted `accentWarn` instead of `accent`.
   * Default 0 (all axes use accent).
   */
  warnThreshold?: number;
  accentWarn?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const DEFAULTS = {
  background: '#0E0E10',
  foreground: '#F5F5F2',
  muted: '#888888',
  accent: '#3B82F6',
  accentWarn: '#F97316',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataRadar: React.FC<DataRadarProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = props.data ?? { axes: [] };
  const axes = Array.isArray(data.axes) ? data.axes : [];
  const background = props.background ?? DEFAULTS.background;
  const foreground = props.foreground ?? DEFAULTS.foreground;
  const muted = props.muted ?? DEFAULTS.muted;
  const accent = props.accent ?? DEFAULTS.accent;
  const accentWarn = props.accentWarn ?? DEFAULTS.accentWarn;
  const warnThreshold = props.warnThreshold ?? 0;
  const rings = Math.max(2, data.rings ?? 4);

  // --- Layout ---
  const n = axes.length;
  if (n === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: background, justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ color: muted, fontSize: Math.round(height * 0.03) }}>No axis data</span>
      </AbsoluteFill>
    );
  }

  // Title area
  const titleH = data.title ? Math.round(height * 0.12) : Math.round(height * 0.04);

  // Radar center & radius — fit within the canvas leaving room for axis labels
  const maxDim = Math.min(width, height - titleH);
  const radarR = Math.max(40, maxDim * 0.38 - Math.round(width * 0.04));
  const cx = Math.round(width / 2);
  const cy = Math.round(titleH + (height - titleH) / 2);

  const maxValue = data.maxValue ?? Math.max(0.001, ...axes.map((a) => Math.abs(Number(a.value) || 0)));
  const angleStep = (2 * Math.PI) / n;

  // Point helper
  const getPoint = (i: number, r: number) => ({
    x: cx + r * Math.sin(i * angleStep),
    y: cy - r * Math.cos(i * angleStep),
  });

  // --- Animations ---
  const titleSpring = spring({ frame, fps, config: { damping: 200 } });
  const fillProgress = spring({
    frame: frame - 5,
    fps,
    config: { damping: 15, stiffness: 100 },
  });

  // Build data polygon
  const dataPath =
    axes
      .map((a, i) => {
        const r = (Math.abs(Number(a.value) || 0) / maxValue) * radarR * fillProgress;
        const p = getPoint(i, r);
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ') + ' Z';

  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: SYSTEM_SANS }}>
      {/* Title */}
      {data.title ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.03),
            left: 0,
            right: 0,
            textAlign: 'center',
            color: foreground,
            fontSize: Math.round(height * 0.045),
            fontWeight: 700,
            letterSpacing: '-0.02em',
            opacity: titleSpring,
            transform: `translateY(${interpolate(titleSpring, [0, 1], [-12, 0])}px)`,
          }}
        >
          {data.title}
        </div>
      ) : null}

      {/* SVG Radar */}
      <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
        {/* Concentric grid rings */}
        {Array.from({ length: rings }, (_, ri) => {
          const ringR = (radarR * (ri + 1)) / rings;
          return (
            <circle
              key={`ring-${ri}`}
              cx={cx}
              cy={cy}
              r={ringR}
              fill="none"
              stroke={background === '#0E0E10' ? '#1A1A1E' : '#E5E5E5'}
              strokeWidth={1}
              strokeDasharray={ri < rings - 1 ? '4 4' : '0'}
            />
          );
        })}

        {/* Axis lines */}
        {axes.map((_, i) => {
          const p = getPoint(i, radarR);
          return (
            <line
              key={`axis-${i}`}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke={background === '#0E0E10' ? '#1A1A1E' : '#E5E5E5'}
              strokeWidth={1}
            />
          );
        })}

        {/* Data polygon fill */}
        <path
          d={dataPath}
          fill={accent}
          fillOpacity={0.2}
          stroke={accent}
          strokeWidth={2}
        />

        {/* Data points + score labels + axis labels */}
        {axes.map((a, i) => {
          const val = Math.abs(Number(a.value) || 0);
          const r = (val / maxValue) * radarR * fillProgress;
          const p = getPoint(i, r);
          const labelP = getPoint(i, radarR + Math.round(width * 0.04));
          const isWarn = warnThreshold > 0 && val < warnThreshold;
          const color = isWarn ? accentWarn : accent;

          // Staggered dot appearance
          const dotDelay = spring({
            frame: frame - i * 3 - 10,
            fps,
            config: { damping: 20, stiffness: 150 },
          });
          const dotOpacity = fillProgress >= ((i + 1) / axes.length) * 0.7 ? dotDelay : 0;

          return (
            <g key={`axis-data-${i}`} style={{ opacity: dotOpacity }}>
              {/* Data point */}
              <circle cx={p.x} cy={p.y} r={5} fill={color} stroke={background} strokeWidth={2} />

              {/* Score label near point */}
              {fillProgress > 0.5 && (
                <text
                  x={p.x}
                  y={p.y - 12}
                  textAnchor="middle"
                  fill={color}
                  fontFamily={SYSTEM_MONO}
                  fontSize={Math.round(Math.min(width, height) * 0.022)}
                  fontWeight={600}
                >
                  {val.toFixed(val < 1 ? 3 : 1)}
                </text>
              )}

              {/* Axis label at outer edge */}
              <text
                x={labelP.x}
                y={labelP.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={foreground}
                fontSize={Math.round(Math.min(width, height) * 0.022)}
                fontWeight={500}
              >
                {a.label}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
