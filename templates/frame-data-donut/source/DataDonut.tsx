/**
 * frame-data-donut — A native Remotion donut/ring chart template.
 *
 * SVG donut slices animate in with spring physics, the center figure rolls up,
 * and legend entries fade in with a staggered delay. Pure system fonts only,
 * no external assets — deterministic and offline-safe.
 *
 * Adapted from Hermes Studio's SceneDonut component (SCPM KPI dashboard).
 * Input data flows through Remotion's inputProps.data.
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

export interface DonutSlice {
  label: string;
  value: number;
  /** Optional hex color. Auto-assigned from a palette if omitted. */
  color?: string;
}

export interface DataDonutData {
  /** Optional title shown above the chart. */
  title?: string;
  /** Optional unit suffix for the center figure. */
  unit?: string;
  /** The slices that make up the donut. */
  items: DonutSlice[];
  /** If provided, shown as the large center figure; otherwise computed as
   *  `items[0].value / total` or simply `items[0].value` for a single item. */
  centerValue?: number;
  /** Optional label under the center figure. Defaults to "Total". */
  centerLabel?: string;
}

export interface DataDonutProps {
  data: DataDonutData;
  /** Background color. Default "#0E0E10". */
  background?: string;
  /** Title + label color. Default "#F5F5F2". */
  foreground?: string;
  /** Muted text (legend labels, center description). Default "#888888". */
  muted?: string;
}

// ---------------------------------------------------------------------------
// Default color palette (10 colors)
// ---------------------------------------------------------------------------

const PALETTE = [
  '#FF5A2C', // orange
  '#3B82F6', // blue
  '#22C55E', // green
  '#EAB308', // yellow
  '#EF4444', // red
  '#A855F7', // purple
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // dark orange
  '#6366F1', // indigo
];

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number with thousands separators. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}

/** Convert degrees to radians. */
function d2r(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * SVG arc path for a donut slice.
 * `startAngle`/`endAngle` in degrees, measured clockwise from 12 o'clock.
 */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const sa = d2r(startAngle - 90);
  const ea = d2r(endAngle - 90);
  const x1 = cx + r * Math.cos(sa);
  const y1 = cy + r * Math.sin(sa);
  const x2 = cx + r * Math.cos(ea);
  const y2 = cy + r * Math.sin(ea);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataDonut: React.FC<DataDonutProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = props.data ?? { items: [] };
  const items = Array.isArray(data.items) ? data.items : [];
  const background = props.background ?? '#0E0E10';
  const foreground = props.foreground ?? '#F5F5F2';
  const muted = props.muted ?? '#888888';
  const unit = data.unit ?? '';

  // Compute totals and angles.
  const total = items.reduce((s, it) => s + Math.max(0, Number(it.value)), 0) || 1;
  const slices = items.map((it, i) => {
    const pct = Math.max(0, Number(it.value)) / total;
    const color = it.color ?? PALETTE[i % PALETTE.length];
    return { ...it, pct, color };
  });

  // Layout — responsive to the real canvas size.
  const isVertical = height > width * 1.1; // tall/narrow → stack vertically
  const padX = Math.round(width * 0.06);
  const padY = Math.round(height * 0.06);

  // Donut dimensions.
  const donutSize = Math.min(
    width - padX * 2,
    height - padY * 2 - (data.title ? height * 0.1 : 0),
  );
  if (!isVertical) {
    // Leave room for legend on the right.
    const donutMaxW = width * 0.55;
    const legendW = width * 0.35;
    const donutW = Math.min(donutMaxW, donutSize);
    // donutSize stays as computed; the SVG will just be positioned left.
  }
  const donutR = Math.max(20, donutSize * 0.38);
  const strokeW = Math.max(8, donutR * 0.26);
  const cx = isVertical ? width / 2 : Math.round(width * 0.30);
  const cy = isVertical
    ? Math.round(height * 0.38)
    : Math.round(height * 0.50);

  // Title animation.
  const titleOpacity = spring({
    frame,
    fps,
    config: { damping: 200 },
  });
  const titleY = interpolate(titleOpacity, [0, 1], [-20, 0]);

  // Legend column start.
  const legendX = isVertical ? padX : Math.round(width * 0.62);
  const legendTop = isVertical
    ? Math.round(cy + donutSize * 0.6)
    : Math.round(height * 0.08 + (data.title ? height * 0.08 : 0));

  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: SYSTEM_SANS }}>
      {/* Title */}
      {data.title ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.04),
            left: padX,
            right: padX,
            textAlign: isVertical ? 'center' : 'left',
            color: foreground,
            fontSize: Math.round(height * 0.048),
            fontWeight: 700,
            letterSpacing: '-0.02em',
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {data.title}
        </div>
      ) : null}

      {/* SVG Donut */}
      <svg
        width={donutSize}
        height={donutSize}
        style={{
          position: 'absolute',
          left: cx - donutSize / 2,
          top: cy - donutSize / 2,
          overflow: 'visible',
        }}
      >
        {/* Background ring (track) - only visible when slices don't fill 100% */}
        <circle
          cx={donutSize / 2}
          cy={donutSize / 2}
          r={donutR}
          fill="none"
          stroke={background === '#0E0E10' ? '#1A1A1E' : '#E5E5E5'}
          strokeWidth={strokeW}
          opacity={0.5}
        />

        {/* Animated slices */}
        {(() => {
          let cumAngle = 0;
          return slices.map((slice, i) => {
            const sliceAngle = slice.pct * 360;
            // Stagger: each slice starts 6 frames after the previous.
            const delay = i * 6;
            const grow = spring({
              frame: frame - delay,
              fps,
              config: { damping: 15, stiffness: 120 },
            });
            const currentAngle = sliceAngle * grow;
            const startAngle = cumAngle;
            cumAngle += sliceAngle;

            if (currentAngle < 0.5) return null; // too small to draw

            const path = arcPath(
              donutSize / 2,
              donutSize / 2,
              donutR,
              startAngle,
              startAngle + currentAngle,
            );

            return (
              <path
                key={`slice-${i}`}
                d={path}
                fill="none"
                stroke={slice.color}
                strokeWidth={strokeW}
                strokeLinecap="butt"
                opacity={interpolate(grow, [0, 0.3], [0, 1], { extrapolateLeft: 'clamp' })}
              />
            );
          });
        })()}

        {/* Center text — rolled value + label */}
        {(() => {
          const rollProgress = spring({
            frame: frame - 10,
            fps,
            config: { damping: 14, mass: 0.7, stiffness: 90 },
          });
          const centerVal = data.centerValue ?? total;
          const rolled = centerVal * rollProgress;
          const centerLabel = data.centerLabel ?? 'Total';
          return (
            <g opacity={rollProgress}>
              <text
                x={donutSize / 2}
                y={donutSize / 2 - 6}
                textAnchor="middle"
                fill={foreground}
                fontFamily={SYSTEM_MONO}
                fontSize={Math.round(donutR * 0.38)}
                fontWeight={700}
              >
                {fmt(rolled)}
                {unit ? ` ${unit}` : ''}
              </text>
              <text
                x={donutSize / 2}
                y={donutSize / 2 + Math.round(donutR * 0.14)}
                textAnchor="middle"
                fill={muted}
                fontFamily={SYSTEM_SANS}
                fontSize={Math.round(donutR * 0.12)}
              >
                {centerLabel}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          left: legendX,
          top: legendTop,
          maxWidth: isVertical ? width - padX * 2 : width - legendX - padX,
        }}
      >
        {slices.map((slice, i) => {
          const staggerDelay = isVertical ? i * 4 : i * 3 + 5;
          const opacity = spring({
            frame: frame - staggerDelay - 10,
            fps,
            config: { damping: 20, stiffness: 150 },
          });
          const pctDisplay = (slice.pct * 100).toFixed(1);

          return (
            <div
              key={`legend-${i}`}
              style={{
                opacity,
                display: 'flex',
                alignItems: 'center',
                marginBottom: Math.round(height * 0.018),
                gap: Math.round(width * 0.012),
                transform: `translateX(${interpolate(opacity, [0, 1], [-12, 0])}px)`,
              }}
            >
              {/* Color dot */}
              <div
                style={{
                  width: Math.round(width * 0.016),
                  height: Math.round(width * 0.016),
                  borderRadius: '50%',
                  backgroundColor: slice.color,
                  flexShrink: 0,
                }}
              />
              {/* Label */}
              <span
                style={{
                  color: foreground,
                  fontSize: Math.round(height * 0.025),
                  fontWeight: 500,
                  lineHeight: 1.3,
                }}
              >
                {slice.label}
              </span>
              {/* Value */}
              <span
                style={{
                  color: muted,
                  fontSize: Math.round(height * 0.022),
                  marginLeft: 'auto',
                  fontFamily: SYSTEM_MONO,
                }}
              >
                {fmt(Math.max(0, Number(slice.value)))}
              </span>
              {/* Percentage */}
              <span
                style={{
                  color: slice.color,
                  fontSize: Math.round(height * 0.022),
                  fontWeight: 600,
                  fontFamily: SYSTEM_MONO,
                  minWidth: Math.round(width * 0.06),
                  textAlign: 'right' as const,
                }}
              >
                {pctDisplay}%
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
