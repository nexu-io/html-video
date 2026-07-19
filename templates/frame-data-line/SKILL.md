# frame-data-line — native Remotion line chart

> SVG path draws in with stroke-dashoffset, gradient fill beneath, data points pop in, trend arrow at the end.

## When to use
- Time-series trends (monthly metrics, quarterly results)
- Growth/decline stories where the momentum itself is the narrative

## Input
- `data.title` — heading (optional)
- `data.points[]` — `{ label, value }` array (min 2, max 24)
- `data.minY` / `data.maxY` — scale bounds (auto-computed if omitted)
- `data.yFormat` — `'number'` | `'percent'` | `'currency'`
- `data.unit` — optional suffix
- `data.gridLines` — Y-axis grid count (default 5)

## Animation
1. Title fades + slides down
2. Line draws left→right via stroke-dashoffset
3. Area gradient fill follows the line
4. Data points pop in as the line passes
5. Trend arrow (▲/▼ ±%) appears after the full draw
