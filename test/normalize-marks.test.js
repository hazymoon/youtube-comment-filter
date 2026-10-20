import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForMatch } from '../src/normalize.js';
import { compileRules } from '../src/rules.js';

test('ゼロ幅文字・ソフトハイフンなどの書式文字を挟んでも NG ワードと同じ形になる', () => {
  assert.equal(normalizeForMatch('し​ね'), 'しね');
  assert.equal(normalizeForMatch('し­ね'), 'しね');
  assert.equal(normalizeForMatch('し⁠ね'), 'しね');
});

test('打ち消し線などの結合文字を重ねても元の文字に戻る', () => {
  assert.equal(normalizeForMatch('s̶h̶i̶'), 'shi');
});

test('スペーシング濁点・半濁点は前の文字と合成する', () => {
  assert.equal(normalizeForMatch('し゛ね'), 'じね');
  assert.equal(normalizeForMatch('は゛か'), 'ばか');
  assert.equal(normalizeForMatch('ハ゜ン'), 'ぱん');
  assert.equal(normalizeForMatch('ﾊﾟﾝ'), 'ぱん');
});

test('書式文字・結合文字・スペーシング濁点で崩した本文も NG ワードに一致する', () => {
  const rules = compileRules({ ngWords: ['ばか'] });
  assert.deepEqual(rules.matchWord('は゛か'), { word: 'ばか' });
  assert.deepEqual(rules.matchWord('ば​か'), { word: 'ばか' });
});
