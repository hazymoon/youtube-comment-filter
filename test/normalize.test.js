import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForMatch, toNfkc } from '../src/normalize.js';

test('toNfkc は全角英数を半角にする', () => {
  assert.equal(toNfkc('ＡＢＣ１２３'), 'ABC123');
});

test('全角英数は半角の小文字になる', () => {
  assert.equal(normalizeForMatch('ＡＢＣ１２３'), 'abc123');
});

test('半角カナはひらがなになる（濁点も合成される）', () => {
  assert.equal(normalizeForMatch('ｶﾀｶﾅ'), 'かたかな');
  assert.equal(normalizeForMatch('ｶﾞｷﾞ'), 'がぎ');
});

test('カタカナはひらがなになる', () => {
  assert.equal(normalizeForMatch('アホ'), 'あほ');
  assert.equal(normalizeForMatch('ヴァ'), 'ゔぁ');
  assert.equal(normalizeForMatch('ヶ'), 'ゖ');
});

test('踊り字のヽヾはゝゞになる', () => {
  assert.equal(normalizeForMatch('ヽヾ'), 'ゝゞ');
});

test('長音符は残る', () => {
  assert.equal(normalizeForMatch('バーカ'), 'ばーか');
});

test('記号・空白・絵文字は消える', () => {
  assert.equal(normalizeForMatch('あ ほ！？。、「」★♪\t\n😀'), 'あほ');
  assert.equal(normalizeForMatch('a.b_c-d'), 'abcd');
});

test('絵文字だけの本文は空文字になる', () => {
  assert.equal(normalizeForMatch('😀👍🔥'), '');
  // Sequences with variation selectors, ZWJ, skin tones, and keycaps.
  assert.equal(normalizeForMatch('❤️👨‍👩‍👧👍🏻1️⃣'), '1');
  assert.equal(normalizeForMatch('❤️👨‍👩‍👧👍🏻'), '');
});

test('タグ文字を使うサブディビジョン旗だけの本文も空文字になる', () => {
  // England flag: U+1F3F4 followed by tag characters and CANCEL TAG.
  assert.equal(normalizeForMatch('\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'), '');
});
