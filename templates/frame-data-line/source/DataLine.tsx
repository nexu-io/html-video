/**
 * frame-data-line — A native Remotion line chart template.
 *
 * An SVG line chart with animated path drawing (stroke-dashoffset), gradient
 * area fill, data point dots that pop in, and a final trend arrow. Every
 * value is driven by real data via inputProps — not a static chart image.
 *
 * Adapted from Hermes Studio's SceneMonthlyTrend component.
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

export interface LinePoint {
  label: string;
  value: number;
}

export interface DataLineData {
  title?: string;
  points: LinePoint[];
  /** Y-axis minimum. Auto-computed if omitted. */
  minY?: number;
  /** Y-axis maximum. Auto-computed if omitted. */
  maxY?: number;
  /** Number of Y-axis grid lines. Default 5. */
  gridLines?: number;
  /** Y-axis value format: 'number' (default), 'percent', 'currency'. */
  yFormat?: 'number' | 'percent' | 'currency';
  /** Optional unit suffix for data point labels. */
  unit?: string;
}

export interface DataLineProps {
  data: DataLineData;
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  /** Color for the area gradient. Defaults to accent with opacity. */
  areaColor?: string;
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
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataLine: React.FC<DataLineProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = props.data ?? { points: [] };
  const points = Array.isArray(data.points) ? data.points : [];
  const background = props.background ?? DEFAULTS.background;
  const foreground = props.foreground ?? DEFAULTS.foreground;
  const muted = props.muted ?? DEFAULTS.muted;
  const accent = props.accent ?? DEFAULTS.accent;
  const areaColor = props.areaColor ?? accent;
  const unit = data.unit ?? '';

  // --- Layout ---
  const margin = {
    top: Math.round(height * (data.title ? 0.16 : 0.08)),
    right: Math.round(width * 0.06),
    bottom: Math.round(height * 0.14),
    left: Math.round(width * 0.10),
  };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  // --- Scale ---
  const values = points.map((p) => Number(p.value) || 0);
  const minY = data.minY ?? (Math.min(...values) * 0.9);
  const maxY = data.maxY ?? (Math.max(...values) * 1.1);
  const yRange = maxY - minY || 1;

  const xStep = points.length > 1 ? chartW / (points.length - 1) : chartW;

  const toX = (i: number) => margin.left + i * xStep;
  const toY = (v: number) => margin.top + chartH - ((v - minY) / yRange) * chartH;

  // --- Title ---
  const titleSpring = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleSpring, [0, 1], [-16, 0]);

  // --- Line animation: stroke-dashoffset reveal ---
  const drawProgress = spring({
    frame: frame - 5,
    fps,
    config: { damping: 20, stiffness: 80 },
  });

  // Compute total path length (approximate via segment sum)
  let totalLength = 0;
  if (points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const dx = toX(i) - toX(i - 1);
      const dy = toY(points[i].value) - toY(points[i - 1].value);
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
  }

  // Build SVG path for the line
  const linePath =
    points.length > 1
      ? points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
          .join(' ')
      : '';

  // Area fill path (line + close down to baseline)
  const areaPath =
    points.length > 1
      ? linePath +
        ` L${toX(points.length - 1).toFixed(1)},${margin.top + chartH}` +
        ` L${toX(0).toFixed(1)},${margin.top + chartH} Z`
      : '';

  // --- Grid lines ---
  const gridCount = Math.max(2, data.gridLines ?? 5);
  const gridLines = Array.from({ length: gridCount }, (_, i) => {
    const v = minY + (yRange * i) / (gridCount - 1);
    return { value: v, y: toY(v) };
  });

  // --- Trend arrow ---
  const showTrend = points.length >= 2;
  const trendStart = points.length >= 2 ? points[0].value : 0;
  const trendEnd = points.length >= 2 ? points[points.length - 1].value : 0;
  const trendPct = trendStart !== 0 ? ((trendEnd - trendStart) / Math.abs(trendStart)) * 100 : 0;
  const trendUp = trendEnd >= trendStart;
  const trendOpacity = interpolate(
    frame,
    [Math.round(fps * (data.title ? 3 : 2.5)), Math.round(fps * (data.title ? 4 : 3.5))],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: SYSTEM_SANS }}>
      {/* Title */}
      {data.title ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.04),
            left: margin.left,
            right: margin.right,
            color: foreground,
            fontSize: Math.round(height * 0.048),
            fontWeight: 700,
            letterSpacing: '-0.02em',
            opacity: titleSpring,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {data.title}
        </div>
      ) : null}

      {/* Chart SVG */}
      {points.length > 1 && (
        <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
          {/* Y-axis grid lines */}
          {gridLines.map((gl, i) => (
            <g key={`grid-${i}`}>
              <line
                x1={margin.left}
                y1={gl.y}
                x2={width - margin.right}
                y2={gl.y}
                stroke={background === '#0E0E10' ? '#1A1A1E' : '#E5E5E5'}
                strokeWidth={1}
                strokeDasharray={i === 0 ? '0' : '4 4'}
              />
              <text
                x={margin.left - 8}
                y={gl.y + 4}
                textAnchor="end"
                fill={muted}
                fontFamily={SYSTEM_MONO}
                fontSize={Math.round(height * 0.018)}
              >
                {formatY(gl.value, data.yFormat)}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {points.map((p, i) => {
            // Show every Nth label to avoid overlap
            const skip = points.length > 12 ? Math.ceil(points.length / 8) : 1;
            if (i % skip !== 0 && i !== points.length - 1) return null;
            return (
              <text
                key={`xlabel-${i}`}
                x={toX(i)}
                y={height - margin.bottom + Math.round(height * 0.025)}
                textAnchor="middle"
                fill={muted}
                fontFamily={SYSTEM_SANS}
                fontSize={Math.round(height * 0.02)}
              >
                {p.label}
              </text>
            );
          })}

          {/* Area fill */}
          <defs>
            <linearGradient id={`area-grad-${accent.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={areaColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={areaColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={areaPath}
            fill={`url(#area-grad-${accent.replace('#', '')})`}
            style={{
              clipPath: `inset(0 ${(1 - drawProgress) * 100}% 0 0)`,
            }}
          />

          {/* Animated line */}
          <path
            d={linePath}
            fill="none"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: totalLength,
              strokeDashoffset: totalLength * (1 - drawProgress),
            }}
          />

          {/* Data points (fade in after line passes) */}
          {points.map((p, i) => {
            const dotDelay = spring({
              frame: frame - i * 4 - 10,
              fps,
              config: { damping: 15, stiffness: 200 },
            });
            const dotProgress = drawProgress >= (i + 1) / points.length ? dotDelay : 0;
            const px = toX(i);
            const py = toY(p.value);

            return (
              <g key={`dot-${i}`} style={{ opacity: dotProgress }}>
                <circle cx={px} cy={py} r={5} fill={accent} stroke={background} strokeWidth={2} />
                {/* Value label above dot */}
                <rect
                  x={px - 28}
                  y={py - 32}
                  width={56}
                  height={20}
                  rx={4}
                  fill={background === '#0E0E10' ? '#1A1A1E' : '#F0F0F0'}
                  opacity={0.9}
                />
                <text
                  x={px}
                  y={py - 18}
                  textAnchor="middle"
                  fill={foreground}
                  fontFamily={SYSTEM_MONO}
                  fontSize={Math.round(height * 0.018)}
                  fontWeight={600}
                >
                  {fmt(p.value)}
                  {unit ? ` ${unit}` : ''}
                </text>
              </g>
            );
          })}

          {/* Trend arrow */}
          {showTrend && drawProgress >= 1 && (
            <g style={{ opacity: trendOpacity }}>
              <text
                x={toX(points.length - 1) + Math.round(width * 0.025)}
                y={toY(points[points.length - 1].value) + Math.round(height * 0.008)}
                fill={trendUp ? '#22C55E' : '#EF4444'}
                fontFamily={SYSTEM_SANS}
                fontSize={Math.round(height * 0.025)}
                fontWeight={600}
              >
                {trendUp ? '▲' : '▼'} {Math.abs(trendPct).toFixed(0)}%
              </text>
            </g>
          )}
        </svg>
      )}

      {/* Fallback for no / single point */}
      {points.length <= 1 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: muted,
            fontSize: Math.round(height * 0.03),
            textAlign: 'center' as const,
          }}
        >
          {points.length === 0 ? 'No data' : 'At least 2 points required'}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(n < 1 ? 2 : 1);
}

function formatY(value: number, fmt?: 'number' | 'percent' | 'currency'): string {
  switch (fmt) {
    case 'percent':
      return `${(value * 100).toFixed(0)}%`;
    case 'currency':
      return `$${fmt(value)}`;
    default:
      if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
      if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
      return value.toFixed(value < 1 ? 3 : 1);
  }
}
