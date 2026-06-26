# Design - Acme Launch System

## System

Create a confident product-launch visual system for B2B software videos. It should feel precise, modern, and high-trust.

## Theme

- Dark graphite background: `#101214`
- Primary text: `#F6F3EC`
- Muted text: `#A7ADB5`
- Accent green: `#3CE6AC`
- Alert accent: `#FF6A3D`
- Avoid purple gradients, glassmorphism, beige backgrounds, and generic SaaS stock styling.

## Typography

- Display: `Inter Tight`, `Arial`, sans-serif
- Body: `Inter`, `Arial`, sans-serif
- Use strong hierarchy: one large headline, one short support line, optional small metadata.
- Keep letter spacing at `0`.

## Composition

- Use a 12-column grid.
- Keep important text inside a 120px safe margin on 1920x1080.
- Prefer left-aligned layouts with one clear focal object.
- Use thin rules, small labels, and restrained data chips.
- Do not put the primary content inside a decorative card.

## Components

- Headline block: large, bold, max 2 lines.
- Metric chip: label, value, unit, optional trend arrow.
- Product frame: simple rectangle or screenshot placeholder with 8px max radius.
- Footer metadata: small mono-style label in the lower left.

## Motion

- First 0.4s: background and grid fade in.
- 0.4s to 1.1s: headline rises 24px and fades in.
- 0.8s to 1.6s: accent rule draws from left to right.
- 1.2s onward: metrics or product frame enter with slight stagger.
- Use `cubic-bezier(0.16, 1, 0.3, 1)` for main movement.
- Avoid bouncing, spinning, confetti, or excessive camera movement.

## Output Rules

- Full-bleed 1920x1080 unless the user asks for another aspect ratio.
- Keep all visible text editable with `data-hv-text`.
- Use real user-provided names, numbers, and claims. Do not invent metrics.

