# frame-data-donut — native Remotion donut chart

> An SVG donut/ring chart where slices grow in with spring physics, the center figure rolls up from 0, and legend items slide in with staggered timing.

## When to use

- Show proportional breakdowns that should feel alive
- KPI water-level attainment (e.g. 4-tier scoring distribution)
- Revenue / budget / headcount splits
- Any "part of a whole" story where static numbers won't do

## Input

| Property | Type | Default | Description |
|---|---|---|---|
| `data.title` | string | — | Optional heading |
| `data.unit` | string | — | Suffix for the center figure (e.g. "K", "%") |
| `data.centerValue` | number | auto (sum of items) | Center rolled figure |
| `data.centerLabel` | string | "Total" | Label under the center figure |
| `data.items[]` | array | **required** | Max 8 items |
| `data.items[].label` | string | **required** | Legend label |
| `data.items[].value` | number | **required** | Slice value |
| `data.items[].color` | string | auto (palette) | Optional hex color |
| `background` | string | #0E0E10 | Canvas background |
| `foreground` | string | #F5F5F2 | Title / label color |
| `muted` | string | #888888 | Secondary text |

## Layout behavior

- **Responsive**: adapts to 16:9, 9:16, 1:1 via `useVideoConfig`
- **Tall aspect** (9:16): stacks donut above legend vertically
- **Wide aspect** (16:9, 1:1): donut left, legend right
- **System fonts**: deterministic rendering, no external font downloads

## Animation

1. **Title** fades + slides down in the first ~0.5s
2. **Slices** grow clockwise with a 6-frame stagger per slice, using spring physics
3. **Center figure** rolls from 0 to the target value with spring easing
4. **Legend items** slide in from the left with staggered timing
