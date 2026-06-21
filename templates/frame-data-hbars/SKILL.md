# frame-data-hbars — native Remotion horizontal bar chart

> Horizontal bars grow from the left with spring physics, values roll up, with optional top/bottom grouping.

## When to use
- Ranked lists (department scores, top/bottom performers)
- Any comparison where the item labels are long (horizontal bars read better)

## Input
- `data.title` — heading (optional)
- `data.items[]` — `{ label, value }` array
- `data.splitAt` — items before this index get `accent`, rest get `accentSecondary` (0 = all `accent`)
- `data.unit` — optional suffix after values
- `background`, `foreground`, `muted`, `accent`, `accentSecondary`

## Animation
1. Title fades + slides down
2. Bars grow left→right with staggered spring physics
3. Values roll from 0 with the bar growth
4. Log scale fallback when value spread > 50×
