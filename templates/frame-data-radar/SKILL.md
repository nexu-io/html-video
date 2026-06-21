# frame-data-radar — native Remotion radar chart

> SVG radar/spider chart: concentric rings, axis labels, spring-animated data polygon with fill, per-axis scores.

## When to use
- Multi-dimensional performance profiling (balanced scorecard, KPI dimensions)
- Showing strengths/weaknesses across several factors at once

## Input
- `data.title` — heading (optional)
- `data.axes[]` — `{ label, value }` array (min 3, max 8)
- `data.maxValue` — scale maximum (auto-computed if omitted)
- `data.rings` — concentric grid ring count (default 4)
- `warnThreshold` — axes below this value tint `accentWarn` instead of `accent`
- `accentWarn` — color for weak axes (default #F97316)

## Animation
1. Title fades in
2. Data polygon fills outward with spring physics from center
3. Data points and axis labels appear staggered
4. Axes below warn threshold render in warning color
