/**
 * Studio chat prompt builder (phase cards + generate / iterate instructions).
 */

import type { TemplateMetadata } from '@html-video/core';
import {
  type PhaseMessage,
  collectContentTurns,
  detectPhase,
  lastCardPickByPhase,
} from './detect-phase.js';
import { summariseHtmlForIterate } from './studio-parse.js';

/** History message shape used by the prompt builder (subset of studio ChatMessage). */
export type PromptMessage = PhaseMessage & {
  agent?: string;
  tool?: string;
  output?: unknown;
  ts?: number;
};

export interface BuildPromptArgs {
  tmpl: TemplateMetadata | null;
  exampleHtml: string;
  priorHtml: string;
  history: PromptMessage[];
  userText: string;
  attachments: Attachment[];
  /** When set, iterate-phase prompts target only this frame's HTML. */
  focusFrameId?: string;
  /** The user's original opening subject, locked across phases. */
  openingTopic?: string;
}

export interface Attachment {
  /** absolute path on disk */
  path: string;
  /** type the AssetStore detected */
  kind: 'image' | 'video' | 'audio' | 'data' | 'text' | 'reference-link';
  /** display name */
  filename: string;
  /** byte size */
  size: number;
  /**
   * For text sources (fetched articles/repos, uploaded .md/.txt), the actual
   * content — inlined directly into the prompt. A bare path is useless to HTTP
   * agents (Messages API runs in the cloud, can't read local disk), and even
   * for CLI agents the content should be the source material, not a file ref.
   */
  inlineText?: string;
}

/**
 * v0.5 chat prompt — guidance-first, not write-HTML-immediately.
 *
 * The system prompt tells the agent to:
 *   - On a vague first turn, ask 1–3 sharp questions instead of writing HTML
 *   - When the request + context are concrete enough, generate the full HTML
 *   - Use attachments as references / actual assets
 *   - Never use a fixed 4-question script — judge per turn what's missing
 *
 * Whether the agent writes HTML this turn is up to the agent. The server
 * extracts a fenced ```html block if present; if not, it's just a chat reply.
 */
// Conversation phase detection lives in detect-phase.ts (table-tested).
// Studio imports detectPhase / collectContentTurns / lastCardPickByPhase / …

/**
 * Render one attachment for the prompt. Text sources with inlined content get
 * their actual content fenced inline (so HTTP agents that can't read local
 * disk still see it); binary/path-only attachments stay a one-line reference.
 */
export function renderAttachment(a: Attachment): string[] {
  if (a.inlineText) {
    return [`- [${a.kind}] ${a.filename} — full content below:`, '```', a.inlineText, '```'];
  }
  return [`- [${a.kind}] ${a.filename} — ${a.path}`];
}

/** A design.md / frame.md / DESIGN.md attachment is a brand + motion SPEC the
 *  video must FOLLOW (palette, type, tokens, pacing/scale/dwell/motion), not
 *  content to be narrated. Detect by filename or by the spec's tell-tale
 *  headings, so users can drop in a design.md (portable design system) or
 *  HeyGen-style frame.md (motion spec). */
export function isDesignSpec(a: Attachment): boolean {
  const name = (a.filename || '').toLowerCase();
  if (/(^|\/)(design|frame)\.md$/.test(name) || /\bframe\.md\b|\bdesign\.md\b/.test(name))
    return true;
  const txt = a.inlineText ?? '';
  if (!txt) return false;
  // Heading/section fingerprints shared by design.md & frame.md specs.
  return (
    /#\s*(design|frame)\s*[—\-]/i.test(txt) ||
    /(^|\n)##\s*(System|Theme|Tokens|Motion|Pacing|Composition)\b/i.test(txt) ||
    /\b(pacing|dwell)\b.*\b(scale|motion)\b/i.test(txt)
  );
}

/** Split attachments into design/motion specs vs ordinary source material. */
export function partitionAttachments(atts: Attachment[]): {
  specs: Attachment[];
  content: Attachment[];
} {
  const specs: Attachment[] = [];
  const content: Attachment[] = [];
  for (const a of atts) (a.inlineText && isDesignSpec(a) ? specs : content).push(a);
  return { specs, content };
}

/** Prompt block telling the agent to OBEY a design/frame spec. */
export function renderDesignSpecBlock(specs: Attachment[]): string[] {
  if (!specs.length) return [];
  const out: string[] = [
    'DESIGN SYSTEM / MOTION SPEC (REQUIRED — obey this for every frame): the file(s)',
    `below define the brand's visual + motion language. Honour their palette,`,
    'typography, tokens, layout AND any motion direction (pacing, scale, dwell,',
    'motion) over your own defaults. This is HOW the video must look/move; the',
    `actual subject still comes from the user's content.`,
  ];
  for (const a of specs) {
    out.push(`--- ${a.filename} ---`);
    out.push((a.inlineText ?? '').slice(0, 6000));
  }
  out.push('');
  return out;
}

/** A content type is multi-frame UNLESS it's an explicitly single-frame kind
 *  (title card / cover / single still). Whitelisting "讲解/explainer/…" was too
 *  narrow — e.g. "概念解说短片" (解说, not 讲解) fell through to single-frame.
 *  Inverting the test makes new/renamed multi-frame types default correctly. */
export function isMultiFrameType(pickedType: string): boolean {
  if (!pickedType) return false;
  const single = /单帧|单画面|标题卡|封面|logo|title.?card|single.?frame|cover|still/i.test(
    pickedType,
  );
  return !single;
}

export function buildHtmlGenerationPrompt(args: BuildPromptArgs): string {
  const { tmpl, exampleHtml, priorHtml, history, userText, attachments, openingTopic } = args;

  // When a template is selected, its own source HTML is the style ground truth —
  // NOT a prior render. Otherwise a project that was previously rendered in some
  // other look would keep feeding that stale look back in as "the style to draw
  // from", and the freshly-picked template gets ignored. Only fall back to
  // priorHtml (iterate-on-last-render) when no template is in play.
  const baseHtml = tmpl
    ? exampleHtml
    : priorHtml && priorHtml !== exampleHtml
      ? priorHtml
      : exampleHtml;
  const trimmed = userText.trim();
  // A fetched article / repo / uploaded doc carries inlined content — that IS
  // the topic, so we should not interrogate the user about what the video is
  // about. The source rides into every phase's prompt via `attachments`.
  const hasSourceMaterial = attachments.some((a) => !!a.inlineText);
  const { phase, inputs } = detectPhase(
    history,
    userText,
    !!tmpl,
    hasSourceMaterial,
    args.focusFrameId ?? '',
  );

  // ---- edit-menu: post-generation "what do you want to change?" card ----
  if (phase === 'edit-menu') {
    const em: string[] = [];
    em.push(
      `The user wants to change the already-generated video but hasn't said what. Reply with ONE short line in their language asking what to change, then ONE fenced \`\`\`hv-options block. Use this EXACT JSON — keep "meta" verbatim:`,
    );
    em.push('```hv-options');
    em.push(
      JSON.stringify(
        {
          meta: { phase: 'edit-menu' },
          question: '想改哪方面？',
          options: [
            { label: '🎨 换风格', hint: '保留内容，换一套视觉风格' },
            { label: '✏️ 改内容', hint: '改文案 / 主题 / 重写脚本' },
            { label: '⏱️ 改时长', hint: '调整每帧时长 / 节奏' },
          ],
          allow_freeform: true,
        },
        null,
        2,
      ),
    );
    em.push('```');
    em.push('');
    em.push(
      'Do NOT write HTML this turn. Do NOT return an empty reply. The hv-options block is REQUIRED.',
    );
    return em.join('\n');
  }

  // ---- opener: hv-options card with meta.phase = "type" ----
  if (phase === 'opener') {
    const opener: string[] = [];
    opener.push(
      `The user just opened a project and said "${trimmed}". You are an HTML-video creation assistant.`,
    );
    opener.push('');
    opener.push('Reply with TWO things, in this exact order:');
    opener.push(`1. ONE friendly opening sentence in the user's language (≤ 25 chars).`);
    opener.push(
      `2. A fenced \`\`\`hv-options block with the 4 content-type choices below. JSON shape EXACTLY as shown — do not change keys or omit "meta":`,
    );
    opener.push('```hv-options');
    opener.push(
      JSON.stringify(
        {
          meta: { phase: 'type' },
          question: '想做哪种内容？',
          options: [
            { label: '单帧标题卡', hint: 'logo / 封面 / 单画面 - 5-10s' },
            { label: '多帧预告片', hint: '产品 / 活动 teaser, 3-6 帧' },
            { label: '数据大字报', hint: '1-2 个核心数字, 社媒爆款风' },
            { label: '概念解说短片', hint: '几帧讲清一个 idea / feature' },
          ],
          allow_freeform: true,
        },
        null,
        2,
      ),
    );
    opener.push('```');
    opener.push('');
    if (tmpl) {
      opener.push(
        `Note: a template "${tmpl.name}" is currently selected (${tmpl.description}). Treat it as a visual style reference only — content type still drives the structure.`,
      );
      opener.push('');
    }
    opener.push(
      'Do NOT write HTML this turn. Do NOT return an empty reply. The hv-options block is REQUIRED.',
    );
    return opener.join('\n');
  }

  // ---- content: free chat asking about topic / headline / data ----
  if (phase === 'content') {
    const pickedType = inputs.pickedType ?? '';
    const turns = inputs.contentTurns ?? [];
    const p: string[] = [];

    // Source material present → DON'T interrogate. The article/repo content is
    // the topic; acknowledge it and let the flow advance to style/format.
    if (hasSourceMaterial) {
      p.push(
        `The user is making a ${pickedType ? `"${pickedType}"` : 'video'} based on the source material below — do NOT ask them what it's about, the content is already provided.`,
      );
      p.push('');
      for (const a of attachments) p.push(...renderAttachment(a));
      p.push('');
      p.push(
        `In the user's language, write ONE short line that names the actual topic/title you read from the source and states the video will be built from it (e.g. "好，我读完了《…》这篇文章 — 这就基于它生成。下一步选风格。"). Do NOT ask the user to retype or summarize anything. End with this hidden marker on its own line:`,
      );
      p.push('<!-- hv-phase:content-question -->');
      p.push('');
      p.push(
        'Plain text + the marker only. NO code blocks. NO questions. Do NOT return an empty reply.',
      );
      return p.join('\n');
    }

    p.push(
      `The user is making a ${pickedType ? `"${pickedType}"` : 'video'}. Collect concrete content for it via natural conversation — DO NOT emit any code block, hv-options, hv-form, or hv-confirm. End your reply with this hidden marker on its own line so the server knows you're still in the content phase:`,
    );
    p.push('<!-- hv-phase:content-question -->');
    p.push('');
    p.push(
      `Goal: surface what the video is ABOUT (topic, brand / project name, headline / tagline, key numbers or data points). The user can answer, partially answer, or say "随便发挥 / skip / 不知道" — accept whatever they give and move on.`,
    );
    p.push('');
    // The user's opening request already names the subject (e.g. "做一个 Open
    // Design 推广视频"). Lock onto it: don't let a vague follow-up answer like
    // "随机/随便/anything" silently become a literal NEW topic — that's how a
    // "promote Open Design" request turned into a probability explainer.
    {
      const openingTopic = history
        .find((m) => m.role === 'user')
        ?.content?.trim()
        .slice(0, 200);
      if (openingTopic) {
        p.push(
          `The user's ORIGINAL opening request was: "${openingTopic}". Treat this as the LOCKED subject of the video unless the user clearly asks to change it.`,
        );
        p.push(
          `If the user's answer this turn CONTRADICTS or seems unrelated to that subject (e.g. they opened with a product/brand video but now answer with an off-topic word), do NOT silently switch topics. Ask ONE short clarifying question: keep the original subject (with the new word as a detail/example/angle), or genuinely change the subject? Treat vague answers like "随机 / 随便 / anything / 你定 / whatever" as "you decide the details, KEEP the original subject" — never as a literal new topic.`,
        );
        p.push('');
      }
    }
    if (turns.length === 0) {
      p.push(
        `This is the first content turn. Ask 1–3 short, sharp questions, in the user's language. Keep it under 60 words. Mention they can answer fully, partially, or just say "skip" / "随便".`,
      );
    } else {
      p.push('The user has already shared:');
      for (const t of turns) p.push(`  - ${t.slice(0, 200)}`);
      p.push('');
      p.push(
        `Either ask ONE more clarifying question, or — if you have enough — write a one-line confirmation like "好，我有思路了，下一步是风格" / "Got it. Next: style." and end with the marker. The server will move on to style automatically when your reply is short / affirmative or when this is your second clarifying round.`,
      );
    }
    p.push('');
    p.push('Reply in plain text + the marker. NO code blocks. Do NOT return an empty reply.');
    return p.join('\n');
  }

  // ---- style: hv-options card with style presets + "pick template" + freeform ----
  if (phase === 'style') {
    const pickedType = inputs.pickedType ?? '';
    const p: string[] = [];
    p.push(
      `The user has shared their content for a "${pickedType}". Now ask them about visual style with ONE hv-options card. JSON shape EXACTLY as shown — keep "meta" verbatim:`,
    );
    p.push('```hv-options');
    p.push(
      JSON.stringify(
        {
          meta: { phase: 'style' },
          question: '视觉风格怎么定？',
          options: [
            { label: 'Cyberpunk glitch', hint: '霓虹 / 故障感 / 高对比' },
            { label: 'Swiss minimalist', hint: '网格 / 无衬线 / 留白' },
            { label: 'Warm-grain magazine', hint: '纸感 / 衬线 / 暖色' },
            { label: 'Mono brutalist', hint: '黑白 / 块状 / 粗体' },
            { label: '从设计模板选', hint: '上方挑一个现成模板' },
          ],
          allow_freeform: true,
        },
        null,
        2,
      ),
    );
    p.push('```');
    p.push('');
    p.push(
      `Add ONE short sentence above the card in the user's language inviting them to pick or describe a vibe. Mention they can also upload a reference image via the 📎 button.`,
    );
    p.push('');
    p.push('Do NOT write HTML this turn. Do NOT return an empty reply.');
    return p.join('\n');
  }

  // ---- need-template: user chose "from design template" but hasn't picked one
  if (phase === 'need-template') {
    const p: string[] = [];
    p.push(
      `The user chose "从设计模板选" (use a design template) but has NOT selected a template yet. Do NOT generate. Tell them — in their language, ONE short friendly line — to pick a template from the top-bar 模板 / Template dropdown, then offer this card so they can confirm once they've picked, or switch to a built-in style instead. JSON shape EXACTLY — keep "meta" verbatim:`,
    );
    p.push('```hv-options');
    p.push(
      JSON.stringify(
        {
          meta: { phase: 'need-template' },
          question: '先在顶部「模板」里选一个模板，选好后点下面继续；或直接选一种内置风格：',
          options: [
            { label: '我已选好模板，继续', hint: '用顶部选中的模板生成' },
            { label: 'Cyberpunk glitch', hint: '霓虹 / 故障感 / 高对比' },
            { label: 'Swiss minimalist', hint: '网格 / 无衬线 / 留白' },
            { label: 'Warm-grain magazine', hint: '纸感 / 衬线 / 暖色' },
            { label: 'Mono brutalist', hint: '黑白 / 块状 / 粗体' },
          ],
          allow_freeform: true,
        },
        null,
        2,
      ),
    );
    p.push('```');
    p.push('');
    p.push('Do NOT write HTML this turn. Do NOT return an empty reply.');
    return p.join('\n');
  }

  // ---- format / format-edit: hv-form with 3 segmented controls ----
  if (phase === 'format' || phase === 'format-edit') {
    const isEdit = phase === 'format-edit';
    const pre = inputs.collected ?? {};
    const pickedType = isEdit
      ? (lastCardPickByPhase(history, 'type') ?? '')
      : (inputs.pickedType ?? '');
    const isMulti = !!pickedType && isMultiFrameType(pickedType);
    const defaults = {
      aspect: pre.aspect ?? '16:9 横屏',
      duration: pre.duration ?? (isMulti ? '15' : '5'),
      frame_count: pre.frame_count ?? (isMulti ? '4' : '1'),
      // Per-frame pacing default 4s — comfortable, avoids the "rushed" feel a
      // short total ÷ many frames produces. Total is derived from this × frames.
      per_frame: pre.per_frame ?? '4',
    };
    const p: string[] = [];
    if (isEdit) {
      p.push(
        'The user wants to revise the format. Re-emit the SAME hv-form card with each `default` set to their last answer so they only need to change what they want.',
      );
    } else {
      p.push(
        `Now ask about format with ONE hv-form card — three segmented controls, no text inputs. JSON shape EXACTLY as shown — keep "meta" verbatim:`,
      );
    }
    // The card is the ONLY acceptable way to ask this. Asking in prose makes
    // the user type a free-form answer with no submit marker, which the flow
    // then fails to recognise and re-asks (issue #2).
    p.push(
      'IMPORTANT: emit the hv-form card below — do NOT ask for size / duration / frames in plain prose, and do NOT list example answers for the user to type.',
    );
    p.push('```hv-form');
    p.push(
      JSON.stringify(
        {
          meta: { phase: 'format' },
          title: isEdit
            ? '改一下格式'
            : isMulti
              ? '最后一步：尺寸 / 每帧时长 / 帧数'
              : '最后一步：选个尺寸 / 时长',
          fields: [
            {
              key: 'aspect',
              label: '画面尺寸',
              kind: 'buttons',
              required: true,
              default: defaults.aspect,
              options: [
                { value: '16:9 横屏', label: '16:9 横屏' },
                { value: '9:16 手机竖屏', label: '9:16 竖屏' },
                { value: '1:1 方形', label: '1:1 方形' },
                { value: '4:5 小红书', label: '4:5 小红书' },
              ],
            },
            // Multi-frame: pace by PER-FRAME duration (total = per_frame × frames,
            // shown live). Single-frame: just a total duration.
            ...(isMulti
              ? [
                  {
                    key: 'per_frame',
                    label: '每帧时长 (秒)',
                    kind: 'buttons',
                    required: true,
                    default: defaults.per_frame,
                    hint: '总时长 = 每帧时长 × 帧数',
                    options: ['2', '3', '4', '5', '6', '8'].map((v) => ({
                      value: v,
                      label: `${v}s`,
                    })),
                  },
                  {
                    key: 'frame_count',
                    label: '帧数',
                    kind: 'buttons',
                    required: true,
                    default: defaults.frame_count,
                    options: ['2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => ({
                      value: v,
                      label: v,
                    })),
                  },
                  // Opt-in: render data frames natively with Remotion. Value is
                  // either '关' or a native template id — Remotion is a user-chosen
                  // enhancement, the AI never flips it (RFC-09).
                  {
                    key: 'remotion_enhance',
                    label: '⚡ 数据帧用 Remotion',
                    kind: 'buttons',
                    required: false,
                    default: '关',
                    hint: '数据帧用原生 Remotion 渲染；其余帧仍走 Hyperframes。选图表类型。',
                    options: [
                      { value: '关', label: '关' },
                      { value: 'frame-data-rollup', label: '开 · 柱状' },
                      { value: 'frame-data-donut', label: '开 · 圆环' },
                      { value: 'frame-data-hbars', label: '开 · 横条' },
                      { value: 'frame-data-line', label: '开 · 折线' },
                      { value: 'frame-data-radar', label: '开 · 雷达' },
                    ],
                  },
                ]
              : [
                  {
                    key: 'duration',
                    label: '时长 (秒)',
                    kind: 'buttons',
                    required: true,
                    default: defaults.duration,
                    options: ['3', '5', '10', '15'].map((v) => ({ value: v, label: `${v}s` })),
                  },
                ]),
          ],
          allow_attachments: false,
        },
        null,
        2,
      ),
    );
    p.push('```');
    p.push('');
    p.push('Do NOT write HTML this turn. Do NOT return an empty reply.');
    return p.join('\n');
  }

  // ---- confirm: emit hv-confirm summarising what was collected ----
  if (phase === 'confirm') {
    const collected = inputs.collected ?? {};
    const pickedType = lastCardPickByPhase(history, 'type') ?? '';
    const pickedStyle = lastCardPickByPhase(history, 'style') ?? '';
    const contentTurns = collectContentTurns(history);
    const summaryRows: { label: string; value: string }[] = [];
    if (pickedType) summaryRows.push({ label: '类型', value: pickedType });
    if (contentTurns.length > 0) {
      summaryRows.push({ label: '内容', value: contentTurns.join(' · ').slice(0, 240) });
    }
    if (pickedStyle) summaryRows.push({ label: '风格', value: pickedStyle });
    if (tmpl) summaryRows.push({ label: '模板', value: tmpl.name });
    const labelMap: Record<string, string> = {
      aspect: '尺寸',
      duration: '时长',
      frame_count: '帧数',
      per_frame: '每帧时长',
    };
    // When pacing by per-frame, show per-frame + frames + derived total.
    const pf = Number(collected.per_frame ?? '') || 0;
    const keys =
      pf > 0 ? ['aspect', 'per_frame', 'frame_count'] : ['aspect', 'duration', 'frame_count'];
    for (const k of keys) {
      const v = collected[k];
      if (v) summaryRows.push({ label: labelMap[k] ?? k, value: k === 'per_frame' ? `${v}s` : v });
    }
    if (pf > 0) {
      const frames = Number(collected.frame_count ?? '4') || 4;
      summaryRows.push({ label: '总时长', value: `${pf * frames}s` });
    }
    if (attachments.length > 0) {
      summaryRows.push({ label: '素材', value: attachments.map((a) => a.filename).join(', ') });
    }

    const p: string[] = [];
    p.push(
      `The user has chosen the format. Emit ONE \`\`\`hv-confirm block (no other code blocks) summarising what you've got, in the user's language. Use this exact JSON — keep "meta":`,
    );
    p.push('');
    p.push('```hv-confirm');
    p.push(
      JSON.stringify(
        {
          meta: { phase: 'confirm' },
          title: '按这些信息生成？',
          summary: summaryRows,
          actions: ['generate', 'edit'],
        },
        null,
        2,
      ),
    );
    p.push('```');
    p.push('');
    // Soft gate: if the subject is too thin to make a meaningful video, nudge
    // the user to add a concrete topic/brand/number — but never block, the card
    // still ships with both actions so they can proceed as-is.
    const contentBlob = contentTurns.join(' ').trim();
    const topicThin =
      attachments.length === 0 &&
      (contentBlob.replace(/\s/g, '').length < 8 ||
        /^(随机|随便|anything|random|whatever|都行|你定|skip|不知道)$/i.test(contentBlob));
    if (topicThin) {
      p.push(
        `NOTE: the collected content ("${contentBlob || '(empty)'}") is very thin / vague. BEFORE the hv-confirm block, add ONE short friendly sentence in the user's language gently flagging that the topic is sparse and inviting them to add a concrete subject / brand / key number for a stronger video — but STILL emit the hv-confirm block exactly as above so they can generate anyway if they want.`,
      );
      p.push('');
    }
    p.push(
      'Do NOT write HTML this turn. Do NOT return an empty reply. The hv-confirm block is REQUIRED.',
    );
    return p.join('\n');
  }

  // ---- generate: actually write the HTML / content-graph ----
  if (phase === 'generate') {
    const collected = inputs.collected ?? {};
    const pickedType = inputs.pickedType ?? '';
    const pickedStyle = inputs.pickedStyle ?? '';
    const contentTurns = inputs.contentTurns ?? [];
    const aspect = (collected.aspect ?? '16:9').split(/\s+/)[0] ?? '16:9'; // strip "16:9 横屏" → "16:9"
    const [w, h] = aspect.includes(':') ? aspect.split(':').map(Number) : [16, 9];
    const isMulti =
      isMultiFrameType(pickedType) ||
      Number(collected.frame_count ?? '1') > 1 ||
      Number(collected.per_frame ?? '0') > 0;

    // Pick a concrete pixel resolution that respects the aspect choice.
    let resolution = '1920×1080';
    if (aspect === '9:16') resolution = '1080×1920';
    else if (aspect === '1:1') resolution = '1080×1080';
    else if (aspect === '4:5') resolution = '1080×1350';

    const styleLabel =
      pickedStyle && /^从设计模板选|template/i.test(pickedStyle)
        ? tmpl
          ? `(use the selected template "${tmpl.name}" — ${tmpl.description})`
          : '(let the model choose)'
        : pickedStyle;

    const p: string[] = [];
    p.push('Generate the HTML video file(s) the user just confirmed.');
    p.push('');
    // Lock the subject to the user's opening request. The content turns below
    // can be as thin as "随机" — without this the video drifts onto that literal
    // word (a "promote Open Design" request became a randomness explainer).
    if (openingTopic) {
      p.push(
        `VIDEO SUBJECT (LOCKED): the user opened with "${openingTopic}". The video MUST be about THIS subject.`,
      );
      p.push(
        `If a content line below is a vague placeholder like "随机 / 随便 / anything / 你定 / whatever", it means "YOU choose the concrete details (selling points, framing, copy) — but the SUBJECT stays "${openingTopic}"". NEVER treat "随机" as the literal topic; do NOT make a video about randomness.`,
      );
      p.push('');
    }
    p.push(
      'Inputs (use these LITERALLY — do NOT make up brand names or facts beyond what is stated):',
    );
    p.push(`- 类型 / type: ${pickedType || '(未指定)'}`);
    if (contentTurns.length > 0) {
      p.push('- 内容 / content (what the user told us in the chat):');
      for (const t of contentTurns) p.push(`  · ${t.replace(/\n/g, ' ').slice(0, 280)}`);
    } else {
      p.push(
        '- 内容 / content: (the user did not specify; pick a sensible default that fits the type, but keep it generic — no fake brand names)',
      );
    }
    if (styleLabel) p.push(`- 风格 / style: ${styleLabel}`);
    p.push(`- 画面尺寸: ${aspect} (${resolution})`);
    p.push(`- 时长: ${collected.duration ?? '?'} 秒`);
    p.push(`- 帧数: ${collected.frame_count ?? (isMulti ? '4' : '1')}`);
    p.push('');
    if (attachments.length > 0) {
      const { specs, content } = partitionAttachments(attachments);
      // A design.md / frame.md is a style+motion spec to OBEY, surfaced first.
      p.push(...renderDesignSpecBlock(specs));
      if (content.length > 0 || specs.length === 0) {
        p.push('Attachments:');
        for (const a of content.length ? content : attachments) p.push(...renderAttachment(a));
        p.push(
          `Use binary attachments (images, data files) as actual assets where appropriate (logo, screenshot, data file). The inlined text/article/repo content above is the SOURCE MATERIAL — base the video's actual content (facts, names, numbers, narrative) on it, don't just decorate with it.`,
        );
        p.push('');
      }
    }
    p.push(
      `Constraints: full-bleed ${resolution}, opens with an animation timeline, inline CSS + JS, single complete <!doctype html>...</html> document(s). CDN imports (Tailwind, GSAP) are fine. Tag every visible text node with data-hv-text set to a stable key (brand_name, headline, item_1, cta…). No prose outside code blocks.`,
    );
    p.push('');
    // Frame-count safety: claude --print can truncate / stall on very large
    // multi-frame batches. Cap at 10 (high frame counts get progressively
    // less reliable in a single pass), and tell the model so it can plan.
    const requestedFrames = Math.max(1, Math.min(10, Number(collected.frame_count ?? '4') || 4));
    // ⚠️ FALLBACK ONLY. Real multi-frame generation goes through
    // runSplitMultiFrameGenerate (the server routes frame_count>1 there before
    // ever reaching this single-shot prompt). This branch only fires if that
    // routing is bypassed. If you change multi-frame grounding / template /
    // source-material rules, change runSplitMultiFrameGenerate — that's the
    // path users actually hit. Keep the two in sync.
    if (isMulti) {
      p.push('Output (multi-frame storyboard) — emit IN THIS EXACT ORDER and SHAPE:');
      p.push('1. ONE ```json#content-graph block.');
      p.push('2. ONE ```html#<nodeId> block per node.');
      p.push('');
      p.push(
        `Aim for ${requestedFrames} frames. Each frame should be self-contained, full-bleed ${resolution}, with its own opening animation. Nothing between blocks.`,
      );
      p.push('');
      if (attachments.length > 0) {
        // The agent has, in practice, been handed the full article yet fallen
        // back to generic "first-principles / see-the-essence" filler. Force it
        // to ground every node in the source material's actual specifics.
        p.push('GROUNDING (REQUIRED — the source material above is the script, not decoration):');
        p.push(
          `- EVERY node's "text" MUST quote or paraphrase a SPECIFIC fact, name, number, product, or claim from the source material. Pull the real proper nouns (product names, companies, metrics, version numbers) verbatim.`,
        );
        p.push(
          `- The "synopsis" MUST name the article's actual subject — not "AI/technology trends" or any vague category.`,
        );
        p.push(
          `- BANNED: generic motivational filler with no tie to the source ("看清本质", "第一性原理", "复杂表象之下", "you really understand…", "the logic behind…"). If a line would fit ANY article, it is wrong — replace it with something that could ONLY come from THIS source.`,
        );
        p.push(
          `- A reader who knows the article must recognize each frame as being about it; a reader who doesn't must learn its specific points.`,
        );
        p.push('');
      }
      // Skeleton for multi-frame — empirically claude --print returns 1 byte
      // without an example, ~10KB with one. Show the exact shape, even with
      // placeholder content; the model fills it in.
      p.push(
        'Skeleton (replace placeholders with the inputs above; expand styling per the chosen type / style):',
      );
      p.push('```json#content-graph');
      p.push(
        JSON.stringify(
          {
            schemaVersion: 1,
            intent: 'explainer',
            synopsis: '<one-line description>',
            nodes: Array.from({ length: requestedFrames }, (_, i) => ({
              id: `frame_${i + 1}`,
              kind:
                i === 0 ? 'text' : i === requestedFrames - 1 ? 'entity' : i % 2 ? 'data' : 'text',
              durationSec: Math.max(
                2,
                Math.floor(Number(collected.duration ?? '15') / requestedFrames),
              ),
            })),
            edges: Array.from({ length: requestedFrames - 1 }, (_, i) => ({
              from: `frame_${i + 1}`,
              to: `frame_${i + 2}`,
              kind: 'sequence',
            })),
          },
          null,
          2,
        ),
      );
      p.push('```');
      p.push('');
      p.push('```html#frame_1');
      p.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
      p.push('```');
      p.push('');
      p.push(
        `(continue with the same shape for the remaining frames — \`\`\`html#frame_2 … \`\`\`html#frame_${requestedFrames})`,
      );
      if (baseHtml && baseHtml.length > 0) {
        p.push('');
        p.push(
          tmpl
            ? `Template HTML — this is the REQUIRED visual style. Reuse its palette, layout, typography, and animation approach; change only the text/data to fit the source material. Do NOT switch to a different look (no dark "cosmic particle" default, etc.):`
            : 'Prior preview HTML to draw style from:',
        );
        p.push('```html');
        p.push(baseHtml.slice(0, 3000));
        p.push('```');
      }
    } else {
      p.push(
        'Output (single-frame): begin your reply with ```html and end with ```. Nothing outside the block.',
      );
      p.push('');
      if (baseHtml && baseHtml.length > 0) {
        p.push(
          tmpl
            ? 'Template HTML — this is the REQUIRED visual style. Reuse its palette, layout, typography, and animation approach; change only the text/data to fit the source material. Do NOT switch to a different look:'
            : 'Prior preview HTML (iterate on its visual style if it fits, or replace if a different vibe is better):',
        );
        p.push('```html');
        p.push(baseHtml.slice(0, 4000));
        p.push('```');
      } else {
        p.push(
          'Skeleton to extend (replace placeholder with the inputs above; expand styling per the chosen type / style):',
        );
        p.push('```html');
        p.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1.2s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
        p.push('```');
      }
    }
    p.push('');
    if (tmpl) {
      p.push(
        `Template visual signature (REQUIRED): ${tmpl.name} — ${tmpl.description}. Match this look — it is the whole reason the template was chosen. Only a single explicit user style note may override it; "based on this article" is NOT such an override.`,
      );
      p.push('');
    }
    p.push(
      'Do NOT return an empty reply. Do NOT emit any of ```hv-options / ```hv-form / ```hv-confirm — those are over.',
    );
    // discard variable since some lints complain
    void w;
    void h;
    return p.join('\n');
  }

  // ---- iterate: post-generation free-form revision ----
  // claude --print is unreliable when fed 6KB+ of HTML and asked to emit
  // 6KB+ back — it silently no-ops in ~50% of attempts. Instead of feeding
  // the whole HTML, we extract the visible text + style summary and let
  // the model REWRITE rather than EDIT. Output is bounded by the same
  // skeleton trick used by generate-phase.
  const it: string[] = [];
  if (args.focusFrameId) {
    it.push(
      `The user has pinned frame "${args.focusFrameId}" and wants to revise ONLY that frame. Apply their request below — write a fresh complete HTML page that delivers the same content, in roughly the same visual style, but with the requested change.`,
    );
  } else {
    it.push(
      'The user is iterating on an existing HTML video. Apply their request below — write a fresh complete HTML page that delivers the same content, in roughly the same visual style, but with the requested change.',
    );
  }
  it.push('');
  it.push('# User request');
  it.push(userText);
  it.push('');
  if (attachments.length > 0) {
    it.push('# Attachments');
    for (const a of attachments) it.push(...renderAttachment(a));
    it.push('');
  }
  if (baseHtml) {
    // IMPORTANT: do NOT inline the raw HTML. Empirically, including 6-8KB
    // of reference HTML in an iterate prompt makes `claude --print` return
    // 1 byte ~70% of the time (verified by hand). A summary of the
    // existing content + palette is enough to anchor a clean rewrite.
    const summary = summariseHtmlForIterate(baseHtml);
    it.push(`# Current frame — what's there now`);
    if (summary.headline) it.push(`Headline: ${summary.headline}`);
    if (summary.subheads.length)
      it.push(`Sub-text:\n${summary.subheads.map((s) => `  · ${s}`).join('\n')}`);
    if (summary.dataPoints.length)
      it.push(`Data points:\n${summary.dataPoints.map((s) => `  · ${s}`).join('\n')}`);
    if (summary.bgColors.length) it.push(`Palette: ${summary.bgColors.join(' / ')}`);
    if (summary.fontFamilies.length) it.push(`Fonts: ${summary.fontFamilies.join(', ')}`);
    it.push('');
  }
  it.push(
    'Output: ONE complete HTML document. Begin your reply with ```html and end with ```. Inline all CSS / JS. Full-bleed 1920×1080. Tag visible text with data-hv-text (preserve existing keys when meaningful). No prose outside the block. Do NOT return an empty reply.',
  );
  it.push('');
  it.push('Skeleton to extend (replace with the real content + visual style):');
  it.push('```html');
  it.push(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;overflow:hidden;font-family:system-ui,sans-serif}
.stage{width:100vw;height:100vh;display:grid;place-items:center;text-align:center;padding:6vw}
h1{font-size:8vw;letter-spacing:-.03em;animation:in 1s ease forwards;opacity:0;transform:translateY(24px)}
@keyframes in{to{opacity:1;transform:none}}
</style></head><body>
<div class="stage"><h1 data-hv-text="headline">PLACEHOLDER</h1></div>
</body></html>`);
  it.push('```');
  return it.join('\n');
}
