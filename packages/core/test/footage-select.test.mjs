import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fillersIn,
  normalizeWord,
  selectTake,
  buildFootageGraph,
} from '../dist/footage.js';

// Build a transcript from a "Word start end" tuple list.
function tr(clip, words) {
  let t = 0;
  return {
    clipAssetId: clip,
    words: words.map((w) => {
      const start = t;
      t += 0.3;
      return { word: w, start, end: t - 0.05 };
    }),
  };
}

test('normalizeWord strips punctuation/case so "Ah!" and um, still match', () => {
  assert.equal(normalizeWord('Ah!'), 'ah');
  assert.equal(normalizeWord('um,'), 'um');
  assert.equal(normalizeWord("it's"), 'its');
});

test('fillersIn finds disfluencies verbatim', () => {
  const t = tr('C1', ['Hello', 'um,', 'world', '"Ah!"']);
  assert.deepEqual(fillersIn(t.words), ['um,', '"Ah!"']);
});

test('selectTake picks the zero-filler complete take, later breaks ties', () => {
  const transcripts = {
    C1: tr('C1', ['We', 'um,', 'verify', 'changes.']),
    C2: tr('C2', ['We', 'verify', 'changes.']), // clean, complete
  };
  const node = selectTake({ scene: 3, title: 'Verify', takes: ['C1', 'C2'] }, transcripts);
  assert.equal(node.kind, 'footage');
  assert.equal(node.clipAssetId, 'C2');
  assert.equal(node.id, 'scene3');
  assert.deepEqual(node.candidateClipAssetIds, ['C1', 'C2']);
  assert.match(node.selectionRationale, /zero fillers/);
  assert.match(node.selectionRationale, /C1 dropped \(fillers: um,\)/);
  assert.ok(node.out > node.in);
});

test('selectTake trims a leading warm-up phrase from the cut-in', () => {
  const transcripts = {
    C3: tr('C3', ['Hey', 'everyone,', "it's", 'Joey.']),
  };
  const node = selectTake(
    { scene: 1, title: 'Intro', takes: ['C3'], warmup: 'hey everyone' },
    transcripts,
  );
  // cut-in should start at "it's" (index 2), not "Hey"
  const itsStart = transcripts.C3.words[2].start;
  assert.ok(Math.abs(node.in - (itsStart - 0.05)) < 1e-6, `in=${node.in}`);
  assert.equal(node.firstWords.split(' ')[0], "it's");
  assert.match(node.selectionRationale, /Warm-up "hey everyone" cut/);
});

test('buildFootageGraph chains scenes with sequence edges', () => {
  const transcripts = {
    A: tr('A', ['First', 'scene.']),
    B: tr('B', ['Second', 'scene.']),
  };
  const g = buildFootageGraph(
    [
      { scene: 1, title: 'One', takes: ['A'] },
      { scene: 2, title: 'Two', takes: ['B'] },
    ],
    transcripts,
  );
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
  assert.deepEqual(g.edges[0], { from: 'scene1', to: 'scene2', kind: 'sequence' });
});

test('selectTake throws on a scene with no candidate takes', () => {
  assert.throws(() => selectTake({ scene: 9, title: 'Empty', takes: [] }, {}), /no candidate takes/);
});
