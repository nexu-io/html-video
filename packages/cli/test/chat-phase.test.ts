import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectPhase,
  hadGenerationYet,
  isFromTemplateStyle,
  lastCardPickByPhase,
  type ChatMessage,
} from '../dist/studio-server.js';

let timestamp = 1;
const user = (content: string): ChatMessage => ({ role: 'user', content, ts: timestamp++ });
const assistant = (content: string, generation?: ChatMessage['generation']): ChatMessage => ({
  role: 'assistant',
  content,
  ...(generation && { generation }),
  ts: timestamp++,
});
const optionsCard = (phase: string): ChatMessage => assistant([
  '```hv-options',
  JSON.stringify({ meta: { phase }, question: 'Pick', options: [] }),
  '```',
].join('\n'));
const formCard = (): ChatMessage => assistant([
  '```hv-form',
  JSON.stringify({ meta: { phase: 'format' }, fields: [] }),
  '```',
].join('\n'));

test('single-frame generation metadata prevents the conversation from returning to opener', () => {
  const history = [
    user('Crie um cartão'),
    assistant('✓ updated the HTML preview', { kind: 'single', frameCount: 1 }),
    user('faz o título maior'),
  ];
  assert.equal(hadGenerationYet(history), true);
  assert.equal(detectPhase(history, 'faz o título maior', false).phase, 'edit-menu');
  assert.equal(detectPhase(history, 'faz o título maior', false, false, 'hero').phase, 'iterate');
});

test('legacy persisted single-frame summary remains generation-compatible', () => {
  const history = [assistant('✓ updated the HTML preview'), user('mude alguma coisa')];
  assert.equal(hadGenerationYet(history), true);
  assert.equal(detectPhase(history, 'mude alguma coisa', false).phase, 'edit-menu');
});

test('latest style card selection wins instead of reusing the first historical pick', () => {
  const history = [
    optionsCard('style'),
    user('Swiss minimalist'),
    assistant('intermediate response'),
    optionsCard('style'),
    user('Warm-grain magazine'),
  ];
  assert.equal(lastCardPickByPhase(history, 'style'), 'Warm-grain magazine');
});

test('format form submit after generation routes to iterate-format and preserves submitted values', () => {
  const body = { aspect: '9:16', per_frame: '5', frame_count: '3' };
  const marker = `[hv-form:submit]\n${JSON.stringify(body)}`;
  const postGeneration = [
    assistant('generated', { kind: 'multi', frameCount: 3 }),
    formCard(),
    user(marker),
  ];
  const result = detectPhase(postGeneration, marker, false);
  assert.equal(result.phase, 'iterate-format');
  assert.equal(result.postGen, true);
  assert.deepEqual(result.inputs.collected, body);

  const initial = detectPhase([formCard(), user(marker)], marker, false);
  assert.equal(initial.phase, 'confirm');
  assert.equal(initial.postGen, undefined);
});

test('Portuguese post-generation intentions route to style, duration and content flows', () => {
  const generated = [assistant('generated', { kind: 'multi', frameCount: 4 })];
  assert.equal(
    detectPhase([...generated, user('quero mudar o estilo e a paleta')], 'quero mudar o estilo e a paleta', false).phase,
    'style',
  );
  assert.equal(
    detectPhase([...generated, user('deixe a duração em 5 segundos por quadro')], 'deixe a duração em 5 segundos por quadro', false).phase,
    'format',
  );
  assert.equal(
    detectPhase([...generated, user('reescreva o conteúdo sobre o lançamento')], 'reescreva o conteúdo sobre o lançamento', false).phase,
    'iterate-content',
  );

  const menuHistory = [...generated, optionsCard('edit-menu'), user('Duração')];
  assert.equal(detectPhase(menuHistory, 'Duração', false).phase, 'format');
});

test('Portuguese and Spanish template choices are recognized without English labels', () => {
  assert.equal(isFromTemplateStyle('Escolher de um modelo de design'), true);
  assert.equal(isFromTemplateStyle('Elegir una plantilla'), true);

  const history = [optionsCard('style'), user('Escolher de um modelo de design')];
  assert.equal(detectPhase(history, 'Escolher de um modelo de design', false).phase, 'need-template');
});
