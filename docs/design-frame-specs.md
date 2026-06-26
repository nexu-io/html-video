# design.md and frame.md

`design.md` and `frame.md` are optional attachment files for the Studio chat composer. Drop one into a project when you want the agent to follow a specific brand, layout, or motion system while generating the video.

They are not scripts or source content. The video subject still comes from your chat prompt, article link, repo, or uploaded text/data content. A design/frame spec only answers: "How should this look and move?"

## When To Use Them

Use a spec when you need repeatable visual direction across generations:

- Brand colors, typography, spacing, logos, and tone
- A motion language: timing, easing, scale, dwell, transitions
- A layout system: grid, safe areas, title positions, chart rules
- Constraints the agent should obey across every frame

If you only want the video to summarize an article or explain a repo, paste the link or upload the content file instead. If you want the video to look like a known design system, add `design.md` or `frame.md` alongside that content.

## design.md vs frame.md

`design.md` is best for a portable visual system. It usually describes brand tokens, typography, composition rules, and reusable components.

`frame.md` is best for a reusable motion frame or shot pattern. It usually describes timing, pacing, transitions, animation beats, and how frames using that pattern should behave.

Today, both `design.md` and `frame.md` apply project-wide: Studio injects detected specs into the storyboard prompt and every per-frame prompt. A single uploaded `frame.md` does not target only one generated scene. Use it to define the motion language for the whole video, not to attach instructions to one specific frame.

The Studio treats both as required style/motion specs. Internally, a file is recognized as a spec when:

- Its filename is `design.md` or `frame.md`, or
- Its headings look like a design/motion spec, such as `## System`, `## Theme`, `## Tokens`, `## Motion`, `## Pacing`, or `## Composition`.

## How To Use

1. Create a `design.md` or `frame.md` file from one of the examples below.
2. In Studio, select or create a project.
3. Drag the file into the chat composer, or use the attachment button.
4. Describe the video content normally.
5. Generate. The agent receives the spec before ordinary content and is instructed to obey it for palette, typography, layout, and motion.

You can attach a spec together with text-like subject sources such as an article link, GitHub repo link, Markdown/text upload, or CSV/data file. The spec controls look and motion; those text/data sources provide the subject matter.

Image assets such as screenshots and logos can still be uploaded as references/assets, but the current split multi-frame generation path does not treat non-text attachments as source material for the storyboard. Describe any important facts from an image in the prompt or a text/data attachment if the video content must depend on them.

## Starter design.md

See [`docs/examples/design.md`](examples/design.md).

## Starter frame.md

See [`docs/examples/frame.md`](examples/frame.md).

## Tips

- Keep the file short enough to be useful. A few precise sections beat a long style manifesto.
- Use concrete values: color hex codes, font names, type sizes, spacing, durations, easing names.
- State what is forbidden, not just what is preferred.
- For multi-frame videos, include rules for consistency across frames.
- For data videos, describe chart scale, labels, units, and animation behavior.
- Avoid putting actual narration or article content in the spec. Put that in the prompt or a separate attachment.
