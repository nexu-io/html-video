import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ConvPhase,
  type PhaseMessage,
  collectContentTurns,
  detectPhase,
  hadGenerationYet,
  isControlPhrase,
  parseFormatReply,
  resolveOpeningTopic,
} from '../dist/detect-phase.js';

function u(content: string): PhaseMessage {
  return { role: 'user', content };
}
function a(content: string): PhaseMessage {
  return { role: 'assistant', content };
}
function hv(kind: 'hv-options' | 'hv-form' | 'hv-confirm', phase: string): string {
  return `\`\`\`${kind}\n${JSON.stringify({ meta: { phase } })}\n\`\`\``;
}
function contentQ(text = '视频想讲什么？'): string {
  return `${text}\n<!-- hv-phase:content-question -->`;
}
/** Matches hadGenerationYet — a real storyboard, not a "✓ updated" summary. */
function generated(): string {
  return '故事板规划完成\n```json#content-graph\n{"nodes":[]}\n```';
}

const typeThen = (...rest: PhaseMessage[]): PhaseMessage[] => [
  a(hv('hv-options', 'type')),
  u('产品介绍'),
  ...rest,
];

interface Case {
  name: string;
  history: PhaseMessage[];
  userText: string;
  hasTemplate?: boolean;
  hasSourceMaterial?: boolean;
  focusFrameId?: string;
  phase: ConvPhase;
  postGen?: boolean;
  pickedType?: string;
  pickedStyle?: string;
  collected?: Record<string, string>;
}

const CASES: Case[] = [
  {
    name: 'empty history → opener',
    history: [],
    userText: '帮我做一个介绍视频',
    phase: 'opener',
  },
  {
    name: 'after type card → content',
    history: [a(hv('hv-options', 'type'))],
    userText: '产品介绍',
    phase: 'content',
    pickedType: '产品介绍',
  },
  {
    name: 'after type card + source material, no template → skip content, go style',
    history: [a(hv('hv-options', 'type'))],
    userText: '产品介绍',
    hasSourceMaterial: true,
    phase: 'style',
    pickedType: '产品介绍',
  },
  {
    name: 'after type card + source + template → format',
    history: [a(hv('hv-options', 'type'))],
    userText: '产品介绍',
    hasTemplate: true,
    hasSourceMaterial: true,
    phase: 'format',
    pickedType: '产品介绍',
  },
  {
    name: 'after style pick → format',
    history: typeThen(a(hv('hv-options', 'style'))),
    userText: '赛博朋克',
    phase: 'format',
    pickedType: '产品介绍',
    pickedStyle: '赛博朋克',
  },
  {
    name: 'style "从设计模板选" without a template → need-template',
    history: typeThen(a(hv('hv-options', 'style'))),
    userText: '从设计模板选',
    phase: 'need-template',
    pickedStyle: '从设计模板选',
  },
  {
    name: 'need-template + 继续, still no template → ask again',
    history: typeThen(
      a(hv('hv-options', 'style')),
      u('从设计模板选'),
      a(hv('hv-options', 'need-template')),
    ),
    userText: '继续',
    phase: 'need-template',
  },
  {
    name: 'need-template + 继续 after picking a template → format',
    history: typeThen(
      a(hv('hv-options', 'style')),
      u('从设计模板选'),
      a(hv('hv-options', 'need-template')),
    ),
    userText: '继续',
    hasTemplate: true,
    phase: 'format',
    pickedStyle: '从设计模板选',
  },
  {
    name: 'need-template + a built-in style name → format with that style',
    history: typeThen(a(hv('hv-options', 'need-template'))),
    userText: '极简',
    phase: 'format',
    pickedStyle: '极简',
  },
  {
    name: 'content-question + 跳过 → style',
    history: typeThen(a(contentQ())),
    userText: '跳过',
    phase: 'style',
    pickedType: '产品介绍',
  },
  {
    name: 'content-question + 随便发挥 advances (does not stall on "风格选择")',
    history: typeThen(a(contentQ())),
    userText: '随便发挥',
    phase: 'style',
    pickedType: '产品介绍',
  },
  {
    name: 'content-question + short real content stays in content',
    history: typeThen(a(contentQ())),
    userText: '我们做供应链软件',
    phase: 'content',
    pickedType: '产品介绍',
  },
  {
    name: 'content-question + skip with template already set → format',
    history: typeThen(a(contentQ())),
    userText: '跳过',
    hasTemplate: true,
    phase: 'format',
  },
  {
    name: 'hv-form:submit → confirm',
    history: typeThen(a(hv('hv-form', 'format'))),
    userText: '[hv-form:submit]\n{"aspect":"16:9 横屏","duration":"5","frame_count":"6"}',
    phase: 'confirm',
    collected: { aspect: '16:9 横屏', duration: '5', frame_count: '6' },
  },
  {
    name: 'hv-confirm:generate → generate',
    history: typeThen(
      a(hv('hv-options', 'style')),
      u('赛博朋克'),
      a(hv('hv-form', 'format')),
      u('[hv-form:submit]\n{"aspect":"16:9 横屏","duration":"5","frame_count":"6"}'),
      a(hv('hv-confirm', 'confirm')),
    ),
    userText: '[hv-confirm:generate]',
    phase: 'generate',
    pickedType: '产品介绍',
    pickedStyle: '赛博朋克',
    collected: { aspect: '16:9 横屏', duration: '5', frame_count: '6' },
  },
  {
    name: 'hv-confirm:edit → format-edit',
    history: [a(hv('hv-confirm', 'confirm'))],
    userText: '[hv-confirm:edit]',
    phase: 'format-edit',
  },
  {
    name: 'issue #2: typed format reply after hv-form card → confirm',
    history: [a(hv('hv-form', 'format'))],
    userText: '16:9 横屏 / 5s / 10',
    phase: 'confirm',
    collected: { aspect: '16:9 横屏', duration: '5', frame_count: '10' },
  },
  {
    name: 'issue #2: typed format reply after prose (no card) → confirm',
    history: [a('请给尺寸（横屏或竖屏）、时长秒数、和帧数')],
    userText: '9:16 竖屏，3秒，6帧',
    phase: 'confirm',
    collected: { aspect: '9:16 手机竖屏', duration: '3', frame_count: '6' },
  },
  {
    name: 'format-looking first message is still opener (not a silent confirm)',
    history: [],
    userText: '16:9 横屏 / 5s / 10',
    phase: 'opener',
  },
  {
    name: 'PR #25: after generate, vague 改一下 → edit-menu (not iterate)',
    history: [...typeThen(a(generated()))],
    userText: '改一下',
    phase: 'edit-menu',
  },
  {
    name: 'PR #25: 换个模板重新生成一下 → style shortcut (not silent iterate)',
    history: [...typeThen(a(generated()))],
    userText: '换个模板重新生成一下',
    phase: 'style',
    postGen: true,
    pickedType: '产品介绍',
  },
  {
    name: 'PR #25: 换个风格 → style',
    history: [...typeThen(a(generated()))],
    userText: '换个风格',
    phase: 'style',
    postGen: true,
  },
  {
    name: 'PR #25: 重新生成 with no style/content/duration cue → edit-menu',
    history: [...typeThen(a(generated()))],
    userText: '重新生成',
    phase: 'edit-menu',
  },
  {
    name: 'PR #25: pinned frame → iterate even for a vague 改一下',
    history: [...typeThen(a(generated()))],
    userText: '改一下',
    focusFrameId: 'intro',
    phase: 'iterate',
  },
  {
    name: 'after generate, 改内容 → iterate-content',
    history: [...typeThen(a(generated()))],
    userText: '改内容，改成讲供应链协同',
    phase: 'iterate-content',
    postGen: true,
  },
  {
    name: 'after generate, 时长改成5秒 → format',
    history: [...typeThen(a(generated()))],
    userText: '时长改成5秒',
    phase: 'format',
    postGen: true,
  },
  {
    name: 'edit-menu pick 换风格 → style',
    history: [...typeThen(a(generated()), a(hv('hv-options', 'edit-menu')))],
    userText: '🎨 换风格',
    phase: 'style',
    postGen: true,
    pickedType: '产品介绍',
  },
  {
    name: 'edit-menu pick 改内容 → content (postGen)',
    history: [...typeThen(a(generated()), a(hv('hv-options', 'edit-menu')))],
    userText: '✏️ 改内容',
    phase: 'content',
    postGen: true,
  },
  {
    name: 'edit-menu pick 改时长 → format',
    history: [...typeThen(a(generated()), a(hv('hv-options', 'edit-menu')))],
    userText: '⏱️ 改时长',
    phase: 'format',
    postGen: true,
  },
  {
    name: 'post-gen answering a re-shown style card → restyle',
    history: [...typeThen(a(generated()), a(hv('hv-options', 'style')))],
    userText: '赛博朋克',
    phase: 'restyle',
    postGen: true,
    pickedStyle: '赛博朋克',
  },
  {
    name: 'post-gen free-text while format card is showing → iterate-format',
    history: [...typeThen(a(generated()), a(hv('hv-form', 'format')))],
    userText: '每帧 4 秒',
    phase: 'iterate-format',
    postGen: true,
  },
  {
    name: 'markers still win post-gen: hv-form:submit → confirm (current contract)',
    history: [...typeThen(a(generated()), a(hv('hv-form', 'format')))],
    userText: '[hv-form:submit]\n{"duration":"4"}',
    phase: 'confirm',
    collected: { duration: '4' },
  },
  {
    name: 'a lone ✓ summary is NOT a generation (old hadGenerationYet false positive)',
    history: [a('✓ 已按新风格重渲每一帧')],
    userText: '改一下',
    phase: 'opener',
  },
];

test('detectPhase table', async (t) => {
  for (const c of CASES) {
    await t.test(c.name, () => {
      const r = detectPhase(
        c.history,
        c.userText,
        c.hasTemplate ?? false,
        c.hasSourceMaterial ?? false,
        c.focusFrameId ?? '',
      );
      assert.equal(r.phase, c.phase);
      assert.equal(r.postGen, c.postGen);
      if (c.pickedType !== undefined) assert.equal(r.inputs.pickedType, c.pickedType);
      if (c.pickedStyle !== undefined) assert.equal(r.inputs.pickedStyle, c.pickedStyle);
      if (c.collected !== undefined) assert.deepEqual(r.inputs.collected, c.collected);
    });
  }
});

test('hadGenerationYet: storyboard markers count; iterate ✓ summaries do not', () => {
  assert.equal(hadGenerationYet([a(generated())]), true);
  assert.equal(hadGenerationYet([a('storyboard generated')]), true);
  assert.equal(hadGenerationYet([a('✓ 已记下你的修改')]), false);
  assert.equal(hadGenerationYet([a('✓ updated preview.html')]), false);
  assert.equal(hadGenerationYet([]), false);
});

test('collectContentTurns skips type-pick and control phrases', () => {
  const history = [
    a(hv('hv-options', 'type')),
    u('产品介绍'),
    u('继续刚刚的任务'),
    u('核心卖点是协同效率'),
    u('[hv-form:submit]\n{"duration":"4"}'),
    a(hv('hv-options', 'style')),
    u('赛博朋克'),
  ];
  assert.deepEqual(collectContentTurns(history), ['核心卖点是协同效率']);
});

test('resolveOpeningTopic prefers intent, else first user turn (not a control phrase)', () => {
  assert.equal(
    resolveOpeningTopic({ intent: 'Open Design 介绍' }, [u('随机')]),
    'Open Design 介绍',
  );
  assert.equal(
    resolveOpeningTopic({}, [u('帮我生成一个关于 Open Design 的介绍视频\n\n📎 附件')]),
    '帮我生成一个关于 Open Design 的介绍视频',
  );
  assert.equal(resolveOpeningTopic({}, [u('继续')]), '');
});

test('isControlPhrase', () => {
  assert.equal(isControlPhrase('继续刚刚的任务'), true);
  assert.equal(isControlPhrase('开始生成'), true);
  assert.equal(isControlPhrase('我们做供应链软件'), false);
});

test('parseFormatReply still reachable from this module', () => {
  assert.equal(parseFormatReply('横屏')?.aspect, '16:9 横屏');
});
