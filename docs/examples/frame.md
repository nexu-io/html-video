# Frame - Editorial Data Reveal

## Purpose

Use this frame pattern when the video needs to reveal one important number or comparison with editorial restraint.

## Composition

- Background: off-white `#F7F4EE`
- Text: near-black `#151515`
- Accent: red `#D81717`
- Layout: 8-column editorial grid, generous margins, no centered dashboard cards.
- Main number occupies the left 60 percent of the frame.
- Context sentence sits below the number.
- Source or timestamp sits in the bottom-left corner.

## Text Slots

- `eyebrow`: short uppercase category, max 28 characters
- `value`: the main number, max 8 characters
- `unit`: optional unit, max 6 characters
- `context`: one sentence explaining why the number matters
- `source`: short source label

## Pacing

- Total duration: 4 to 6 seconds.
- 0.0s to 0.5s: background and grid lines fade in.
- 0.4s to 1.0s: eyebrow appears.
- 0.7s to 1.6s: main number counts or wipes in.
- 1.2s to 2.0s: context sentence fades up.
- 1.8s to 2.4s: source label appears.
- Hold final layout for at least 1.5 seconds.

## Motion Rules

- Use linear or eased numeric rollups only when the user supplied real numeric data.
- If the value is not numeric, use a mask reveal instead of a counter.
- Keep movement subtle: no large rotations, no 3D, no particle effects.
- Respect reduced-motion by showing the final static state.

## Quality Bar

- The number must be readable at thumbnail size.
- The unit must not overpower the number.
- Do not mix unrelated units in one chart.
- Do not invent source labels or fake data.

