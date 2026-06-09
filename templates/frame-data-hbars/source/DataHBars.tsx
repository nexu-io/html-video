/**
 * frame-data-hbars — A native Remotion horizontal bar chart template.
 *
 * Horizontal bars grow from the left with spring physics, each labeled with
 * its value. Items can be split into "top" and "bottom" groups with different
 * accent colors. Pure system fonts, no external assets.
 *
 * Adapted from Hermes Studio's SceneDeptBars component.
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

export interface HBarItem {
  label: string;
  value: number;
}

export interface DataHBarsData {
  title?: string;
  /** Bars drawn top-to-bottom in this order. */
  items: HBarItem[];
  /**
   * Split index: items before this index render with `accent` color,
   * items at and after render with `accentSecondary`. 0 = all primary.
   */
  splitAt?: number;
  /** Optional unit suffix after the value label. */
  unit?: string;
}

export interface DataHBarsProps {
  data: DataHBarsData;
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  accentSecondary?: string;
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
  accent: '#22C55E',
  accentSecondary: '#EF4444',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataHBars: React.FC<DataHBarsProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const data = props.data ?? { items: [] };
  const items = Array.isArray(data.items) ? data.items : [];
  const background = props.background ?? DEFAULTS.background;
  const foreground = props.foreground ?? DEFAULTS.foreground;
  const muted = props.muted ?? DEFAULTS.muted;
  const accent = props.accent ?? DEFAULTS.accent;
  const accentSecondary = props.accentSecondary ?? DEFAULTS.accentSecondary;
  const unit = data.unit ?? '';
  const splitAt = data.splitAt ?? 0;

  // Layout
  const padX = Math.round(width * 0.06);
  const padTop = Math.round(height * (data.title ? 0.14 : 0.06));
  const padBottom = Math.round(height * 0.06);
  const barHeight = Math.max(14, Math.round(height * 0.032));
  const barGap = Math.round(barHeight * 0.65);
  const labelW = Math.round(width * 0.2);
  const barAreaX = padX + labelW + Math.round(width * 0.02);
  const barAreaW = width - barAreaX - padX;
  const chartH = items.length * (barHeight + barGap);
  const chartTop = padTop;

  // Determine max value for scaling
  const maxValue = Math.max(0.001, ...items.map((it) => Math.abs(Number(it.value) || 0)));

  // Use log scale if spread is extreme (max ≥ 50 × min positive).
  const positives = items.filter((it) => (Number(it.value) || 0) > 0);
  const minPositive = positives.length > 0
    ? Math.min(...positives.map((it) => Number(it.value) || 0))
    : maxValue;
  const useLog = minPositive > 0 && maxValue / minPositive >= 50;

  const barFrac = (value: number): number => {
    const v = Math.abs(value || 0);
    if (v <= 0) return 0;
    if (!useLog) return v / maxValue;
    const logMin = Math.log(minPositive);
    const logMax = Math.log(maxValue);
    const t = (Math.log(v) - logMin) / (logMax - logMin || 1);
    return 0.25 + t * 0.75;
  };

  // Title animation
  const titleSpring = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleSpring, [0, 1], [-16, 0]);

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

      {/* Bars */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: chartTop,
          width,
          height: chartH,
        }}
      >
        {items.map((it, i) => {
          const rawValue = Number(it.value) || 0;
          const isPrimary = splitAt > 0 && i < splitAt;
          const color = isPrimary ? accent : (splitAt > 0 ? accentSecondary : accent);
          const delay = i * Math.round(fps * 0.08);
          const grow = spring({
            frame: frame - delay,
            fps,
            config: { damping: 16, mass: 0.8, stiffness: 120 },
          });

          const barWidth = barFrac(rawValue) * barAreaW * grow;
          const y = i * (barHeight + barGap);
          const yOffset = interpolate(grow, [0, 1], [barHeight * 0.3, 0]);

          // Value label — rolls 0 → value tracking the bar growth.
          const rolled = rawValue * grow;

          return (
            <div
              key={`bar-${i}`}
              style={{
                position: 'absolute',
                left: 0,
                top: y + yOffset,
                width,
                height: barHeight,
                opacity: interpolate(grow, [0, 0.3], [0, 1], { extrapolateLeft: 'clamp' }),
              }}
            >
              {/* Label */}
              <div
                style={{
                  position: 'absolute',
                  left: padX,
                  top: 0,
                  width: labelW,
                  height: barHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: Math.round(width * 0.015),
                }}
              >
                <span
                  style={{
                    color: foreground,
                    fontSize: Math.round(height * 0.022),
                    fontWeight: 500,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                    maxWidth: labelW,
                  }}
                >
                  {it.label}
                </span>
              </div>

              {/* Bar background track */}
              <div
                style={{
                  position: 'absolute',
                  left: barAreaX,
                  top: Math.round(barHeight * 0.1),
                  width: barAreaW,
                  height: Math.round(barHeight * 0.8),
                  backgroundColor: background === '#0E0E10' ? '#1A1A1E' : '#E5E5E5',
                  borderRadius: Math.round(barHeight * 0.15),
                  overflow: 'hidden',
                }}
              >
                {/* Animated fill */}
                <div
                  style={{
                    width: barWidth,
                    height: '100%',
                    backgroundColor: color,
                    borderRadius: Math.round(barHeight * 0.15),
                    transition: 'none',
                  }}
                />
              </div>

              {/* Value text */}
              <div
                style={{
                  position: 'absolute',
                  left: barAreaX + barWidth + Math.round(width * 0.01),
                  top: 0,
                  height: barHeight,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    color: color,
                    fontFamily: SYSTEM_MONO,
                    fontSize: Math.round(height * 0.022),
                    fontWeight: 600,
                    opacity: interpolate(grow, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
                  }}
                >
                  {fmt(rolled)}
                  {unit ? ` ${unit}` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
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
  return Math.round(n).toLocaleString('en-US');
}
