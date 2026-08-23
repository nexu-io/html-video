/**
 * Studio conversation phase detector (pure).
 *
 * Extracted from studio-server so the state machine can be table-tested
 * without booting HTTP / agents. Behaviour is the sequential card protocol:
 *
 *   opener → type → content → style → format → confirm → generate
 *   post-gen: edit-menu / restyle / iterate-content / iterate-format / iterate
 *
 * Historical bugs this module must not regress:
 *   - issue #2: free-text format answers ("16:9 横屏 / 5s / 10") looping
 *   - PR #25: after generate, ANY message was forced to `iterate` (single-frame
 *     preview rewrite), so "换个模板重新生成一下" looked like a no-op
 *   - `hadGenerationYet` used to match any "✓ ", including iterate summaries
 */

export type ConvPhase =
  | 'opener'
  | 'content'
  | 'style'
  | 'need-template'
  | 'format'
  | 'format-edit'
  | 'confirm'
  | 'generate'
  | 'iterate'
  | 'edit-menu'
  | 'restyle'
  | 'iterate-content'
  | 'iterate-format';

/** Minimal history shape the detector reads. Studio ChatMessage is assignable. */
export interface PhaseMessage {
  role: string;
  content: string;
}

export interface PhaseInputs {
  collected?: Record<string, string>;
  pickedType?: string;
  pickedStyle?: string;
  contentTurns?: string[];
}

export type PhaseResult = { phase: ConvPhase; inputs: PhaseInputs; postGen?: boolean };

/** Did the user pick the "choose from design templates" style option? */
export function isFromTemplateStyle(style: string): boolean {
  return /^从设计模板选|design template|pick.*template|from template/i.test(style.trim());
}

export function detectPhase(
  history: readonly PhaseMessage[],
  userText: string,
  hasTemplate: boolean,
  hasSourceMaterial = false,
  focusFrameId = '',
): PhaseResult {
  const trimmed = userText.trim();
  const inputs: PhaseInputs = {};

  // Explicit markers always win.
  if (trimmed.startsWith('[hv-form:submit]')) {
    const body = trimmed.slice('[hv-form:submit]'.length).trim();
    try {
      inputs.collected = JSON.parse(body);
    } catch {
      /* ignore */
    }
    return { phase: 'confirm', inputs };
  }
  if (trimmed === '[hv-confirm:generate]') {
    inputs.collected = lastFormSubmission(history);
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.pickedStyle = lastCardPickByPhase(history, 'style') ?? '';
    inputs.contentTurns = collectContentTurns(history);
    return { phase: 'generate', inputs };
  }
  if (trimmed === '[hv-confirm:edit]') {
    inputs.collected = lastFormSubmission(history);
    return { phase: 'format-edit', inputs };
  }

  // Free-text format reply rescue (issue #2): if the previous assistant turn
  // was asking for format params (whether it rendered the hv-form card or — as
  // the model sometimes does — just asked in prose), and this user turn parses
  // as a format answer, treat it like a card submit and advance to confirm.
  if (!hadGenerationYet(history) && lastAssistantAskedFormat(history)) {
    const parsed = parseFormatReply(trimmed);
    if (parsed) {
      inputs.collected = { ...(lastFormSubmission(history) ?? {}), ...parsed };
      return { phase: 'confirm', inputs };
    }
  }

  // Post-generation iteration. Previously ANY message after a generation was
  // forced to phase 'iterate', which only ever did a vague single-frame rewrite
  // of preview.html — so "换个风格" / "改内容" looked like nothing happened.
  if (hadGenerationYet(history)) {
    const last = lastAssistantCardWithMeta(history);
    if (last?.metaPhase === 'edit-menu') {
      if (/风格|style|视觉|配色|换个?样子/i.test(trimmed)) {
        inputs.pickedType = lastCardPickByPhase(history, 'type');
        return { phase: 'style', inputs, postGen: true };
      }
      if (/时长|时间|duration|长度|快|慢|秒|节奏/i.test(trimmed)) {
        inputs.pickedType = lastCardPickByPhase(history, 'type');
        return { phase: 'format', inputs, postGen: true };
      }
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = collectContentTurns(history);
      return { phase: 'content', inputs, postGen: true };
    }
    if (last?.metaPhase === 'style') {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.pickedStyle = trimmed;
      return { phase: 'restyle', inputs, postGen: true };
    }
    if (last?.metaPhase === 'format' || last?.kind === 'hv-form') {
      inputs.collected = lastFormSubmission(history);
      return { phase: 'iterate-format', inputs, postGen: true };
    }
    if (last?.kind === 'content-question') {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed];
      return { phase: 'iterate-content', inputs, postGen: true };
    }
    const pinned = !!focusFrameId;
    if (pinned) {
      return { phase: 'iterate', inputs: { collected: lastFormSubmission(history) } };
    }
    if (
      /风格|样式|配色|视觉|主题色|模板|template|style|换个?样子|赛博|极简|杂志|brutal|cyber|swiss/i.test(
        trimmed,
      )
    ) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      return { phase: 'style', inputs, postGen: true };
    }
    if (/时长|时间|duration|时间长度|节奏|快一点|慢一点|更短|更长|多少秒/i.test(trimmed)) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      return { phase: 'format', inputs, postGen: true };
    }
    if (
      /文案|内容|主题|改成|换成|重写|讲|介绍|加.{0,4}(信息|数据|卖点)|text|content|rewrite/i.test(
        trimmed,
      )
    ) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed].filter(
        (s) => !isControlPhrase(s),
      );
      return { phase: 'iterate-content', inputs, postGen: true };
    }
    return { phase: 'edit-menu', inputs };
  }

  const prev = lastAssistantCardWithMeta(history);

  if (!prev) {
    return { phase: 'opener', inputs };
  }

  if (prev.kind === 'hv-options' && prev.metaPhase === 'type') {
    inputs.pickedType = trimmed;
    if (hasSourceMaterial) {
      inputs.contentTurns = collectContentTurns(history);
      return hasTemplate ? { phase: 'format', inputs } : { phase: 'style', inputs };
    }
    return { phase: 'content', inputs };
  }

  if (prev.kind === 'hv-options' && prev.metaPhase === 'style') {
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.pickedStyle = trimmed;
    inputs.contentTurns = collectContentTurns(history);
    if (isFromTemplateStyle(trimmed) && !hasTemplate) {
      return { phase: 'need-template', inputs };
    }
    return { phase: 'format', inputs };
  }

  if (prev.kind === 'hv-options' && prev.metaPhase === 'need-template') {
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.contentTurns = collectContentTurns(history);
    if (!isFromTemplateStyle(trimmed) && !/^我已选好模板|继续|done|ready|next$/i.test(trimmed)) {
      inputs.pickedStyle = trimmed;
      return { phase: 'format', inputs };
    }
    if (hasTemplate) {
      inputs.pickedStyle = '从设计模板选';
      return { phase: 'format', inputs };
    }
    return { phase: 'need-template', inputs };
  }

  if (prev.kind === 'content-question') {
    const isSkip =
      /^(skip|跳过|够了|够|done|next|下一步|ok|好|不知道)$/i.test(trimmed) || trimmed.length <= 3;
    const isFreeRein =
      trimmed.length <= 16 &&
      /(随便|随机|随意|你定|你来定|你决定|都行|都可以|看着办|自由发挥|发挥|无所谓|任意|随你)/.test(
        trimmed,
      );
    if (isSkip || isFreeRein || hasSourceMaterial || hasEnoughContent(history, trimmed)) {
      inputs.pickedType = lastCardPickByPhase(history, 'type');
      inputs.contentTurns = [...collectContentTurns(history), trimmed];
      return hasTemplate ? { phase: 'format', inputs } : { phase: 'style', inputs };
    }
    inputs.pickedType = lastCardPickByPhase(history, 'type');
    inputs.contentTurns = [...collectContentTurns(history), trimmed];
    return { phase: 'content', inputs };
  }

  inputs.collected = lastFormSubmission(history);
  return { phase: 'iterate', inputs };
}

function hasEnoughContent(history: readonly PhaseMessage[], pending: string): boolean {
  const turns = collectContentTurns(history);
  return turns.length >= 2 || (turns.length >= 1 && pending.length > 60);
}

export function lastAssistantCardWithMeta(history: readonly PhaseMessage[]): {
  kind: 'hv-options' | 'hv-form' | 'hv-confirm' | 'content-question';
  metaPhase: string | null;
} | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m) continue;
    if (m.role !== 'assistant') continue;
    const c = m.content;
    if (!c.trim() || /^⚠️/.test(c.trim())) continue;
    const cards: { kind: 'hv-options' | 'hv-form' | 'hv-confirm'; re: RegExp }[] = [
      { kind: 'hv-confirm', re: /```hv-confirm\s*\n([\s\S]*?)```/i },
      { kind: 'hv-form', re: /```hv-form\s*\n([\s\S]*?)```/i },
      { kind: 'hv-options', re: /```hv-options\s*\n([\s\S]*?)```/i },
    ];
    for (const { kind, re } of cards) {
      const match = re.exec(c);
      if (match?.[1]) {
        let metaPhase: string | null = null;
        try {
          const parsed = JSON.parse(match[1].trim());
          metaPhase = parsed?.meta?.phase ?? null;
        } catch {
          /* unparseable card body — treat as untagged */
        }
        return { kind, metaPhase };
      }
    }
    if (/<!--\s*hv-phase:content-question\s*-->/i.test(c)) {
      return { kind: 'content-question', metaPhase: 'content' };
    }
    return null;
  }
  return null;
}

export function lastCardPickByPhase(
  history: readonly PhaseMessage[],
  phase: string,
): string | undefined {
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i];
    const u = history[i + 1];
    if (!a || !u) continue;
    if (a.role !== 'assistant' || u.role !== 'user') continue;
    const m = /```hv-options\s*\n([\s\S]*?)```/i.exec(a.content);
    if (!m || !m[1]) continue;
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed?.meta?.phase === phase) return u.content.trim();
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function isControlPhrase(t: string): boolean {
  const s = t
    .trim()
    .toLowerCase()
    .replace(/[。.!！~\s]+$/u, '');
  if (s.length > 12) return false;
  return /^(继续|继续(刚刚|上次|之前)的?任务|接着|接着(来|做|生成)|下一步|开始(生成)?|生成(吧)?|go|continue|next|start|ok|好的?|行|走|动手|可以|确认)$/u.test(
    s,
  );
}

export function collectContentTurns(history: readonly PhaseMessage[]): string[] {
  const out: string[] = [];
  let inContent = false;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (!m) continue;
    if (m.role === 'assistant') {
      const c = m.content;
      const typeMatch = /```hv-options\s*\n([\s\S]*?)```/i.exec(c);
      if (typeMatch?.[1]) {
        try {
          const parsed = JSON.parse(typeMatch[1].trim());
          if (parsed?.meta?.phase === 'type') {
            inContent = true;
            continue;
          }
          if (parsed?.meta?.phase === 'style') {
            inContent = false;
            continue;
          }
        } catch {
          /* ignore */
        }
      }
      if (/```hv-form\s*\n/i.test(c)) inContent = false;
      continue;
    }
    if (m.role !== 'user') continue;
    if (!inContent) continue;
    const t = m.content.trim();
    if (!t) continue;
    if (t.startsWith('[hv-')) continue;
    if (isControlPhrase(t)) continue;
    if (out.length === 0) {
      out.push('__TYPE_PICK__');
      continue;
    }
    out.push(t);
  }
  return out.filter((t) => t !== '__TYPE_PICK__');
}

export function resolveOpeningTopic(
  project: { intent?: string },
  history: readonly PhaseMessage[],
): string {
  const fromIntent = project.intent?.trim();
  if (fromIntent) return fromIntent.slice(0, 200);
  const firstUser = history.find((m) => m.role === 'user')?.content ?? '';
  const clean = (firstUser.split('\n\n📎')[0] ?? '').trim();
  if (!clean || isControlPhrase(clean)) return '';
  return clean.slice(0, 200);
}

export function lastFormSubmission(
  history: readonly PhaseMessage[],
): Record<string, string> | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m) continue;
    if (m.role !== 'user') continue;
    const match = /^\[hv-form:submit\]\s*\n([\s\S]+)$/.exec(m.content.trim());
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* keep scanning */
      }
    }
  }
  return undefined;
}

export function hadGenerationYet(history: readonly PhaseMessage[]): boolean {
  return history.some(
    (m) =>
      m.role === 'assistant' &&
      /```json#content-graph|故事板规划完成|storyboard (generated|regenerated|restyled)|帧完成|frame .* (done|完成)/i.test(
        m.content,
      ),
  );
}

export function lastAssistantAskedFormat(history: readonly PhaseMessage[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m) continue;
    if (m.role !== 'assistant') continue;
    const c = m.content;
    if (!c.trim() || /^⚠️/.test(c.trim())) continue;
    const form = /```hv-form\s*\n([\s\S]*?)```/i.exec(c);
    if (form?.[1]) {
      try {
        return JSON.parse(form[1].trim())?.meta?.phase === 'format';
      } catch {
        return true;
      }
    }
    const hits = [
      /尺寸|横屏|竖屏|方形|aspect|比例/i,
      /时?长|秒|duration|\bs\b/i,
      /帧|frames?/i,
    ].filter((re) => re.test(c)).length;
    return hits >= 2;
  }
  return false;
}

export function parseFormatReply(text: string): Record<string, string> | undefined {
  const t = text.trim();
  if (!t || t.length > 80) return undefined;
  const out: Record<string, string> = {};

  const ratio = /\b(16\s*[:：]\s*9|9\s*[:：]\s*16|1\s*[:：]\s*1|4\s*[:：]\s*5)\b/.exec(t);
  const ratioNorm = ratio?.[1]?.replace(/\s/g, '').replace('：', ':');
  if (ratioNorm === '16:9' || /横屏|landscape|宽屏/i.test(t)) out.aspect = '16:9 横屏';
  else if (ratioNorm === '9:16' || /竖屏|手机|portrait|vertical/i.test(t))
    out.aspect = '9:16 手机竖屏';
  else if (ratioNorm === '1:1' || /方形|square/i.test(t)) out.aspect = '1:1 方形';
  else if (ratioNorm === '4:5' || /小红书|xiaohongshu|rednote/i.test(t)) out.aspect = '4:5 小红书';

  const dur = /(\d{1,3})\s*(?:s\b|秒|sec)/i.exec(t);
  if (dur?.[1]) out.duration = dur[1];

  const fr = /(\d{1,2})\s*(?:帧|frames?)\b/i.exec(t);
  if (fr?.[1]) out.frame_count = fr[1];
  else {
    const parts = t
      .split(/[/、,，]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last) {
        const bare = /^(\d{1,2})\s*帧?$/.exec(last);
        if (bare?.[1] && !/[:：s秒]/.test(last)) out.frame_count = bare[1];
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
