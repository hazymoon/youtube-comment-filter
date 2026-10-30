import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForMatch, replaceConfusableLetters } from '../src/normalize.js';
import { compileRules } from '../src/rules.js';

// "ѕраm": Cyrillic dze, er, a + Latin m (Cyrillic em has no Latin look-alike in confusables)
const CYRILLIC_SPAM = 'ѕраm';

test('ラテン文字に見えるキリル文字・ギリシャ文字をラテン文字に置き換える', () => {
  assert.equal(replaceConfusableLetters(CYRILLIC_SPAM), 'spam');
  // ο, ν, α: Greek omicron, nu, alpha
  assert.equal(replaceConfusableLetters('ονα'), 'ova');
});

test('キリル文字で崩した本文は、ラテン文字の本文と同じ形になる', () => {
  assert.equal(normalizeForMatch(CYRILLIC_SPAM), 'spam');
});

test('大文字のキリル文字も小文字化してから置き換える', () => {
  // "ЅРАM": Cyrillic capital dze, er, a + Latin M
  assert.equal(normalizeForMatch('ЅРАM'), 'spam');
});

test('日本語とラテン文字は変わらない', () => {
  assert.equal(normalizeForMatch('こんにちは'), 'こんにちは');
  assert.equal(normalizeForMatch('スパム'), 'すぱむ');
  assert.equal(normalizeForMatch('Spam'), 'spam');
});

test('キリル文字で崩した本文がラテン文字の NG ワードに一致する', () => {
  const rules = compileRules({ ngWords: ['spam'] });
  assert.deepEqual(rules.matchWord(CYRILLIC_SPAM), { word: 'spam' });
});

test('キリル文字で書いた NG ワードもラテン文字の本文に一致する', () => {
  const rules = compileRules({ ngWords: [CYRILLIC_SPAM] });
  assert.deepEqual(rules.matchWord('spam'), { word: CYRILLIC_SPAM });
});

test('正規表現の NG ワードもキリル文字で崩した本文に一致する', () => {
  const rules = compileRules({ ngWords: [/spam/] });
  assert.deepEqual(rules.matchWord(CYRILLIC_SPAM), { word: '/spam/' });
});

test('小文字にするとラテン文字に似なくなる大文字も、大文字の形で置き換える', () => {
  // Cyrillic capital em / ve: their lowercase forms (м, в) do not look Latin
  assert.equal(normalizeForMatch('SPAМ'), 'spam');
  assert.equal(normalizeForMatch('ВAD'), 'bad');
});

test('大文字と小文字で似るラテン文字が違うギリシャ文字は、大文字の形で置き換える', () => {
  // Greek capital nu / omicron / upsilon look like N / O / Y, while lowercase nu / upsilon look like v / u
  // "ΝO": Greek capital nu + Latin O (an all-Greek word is left as is)
  assert.equal(normalizeForMatch('ΝO'), 'no');
  assert.equal(normalizeForMatch('ΥES'), 'yes');
});

test('小文字だけがラテン文字に似る文字は、大文字で書いても小文字化した後に置き換える', () => {
  // Cyrillic capital sha / ghe: only their lowercase forms (ш, г) are in confusables
  assert.equal(normalizeForMatch('ШOW'), 'wow');
  assert.equal(normalizeForMatch('ГED'), 'red');
});

test('キリル文字・ギリシャ文字だけで書いた語は置き換えない（本物のロシア語・ギリシャ語を英語の NG ワードに当てない）', () => {
  // "сор" (Russian for "rubbish") is all Cyrillic and must not become "cop"
  assert.equal(normalizeForMatch('сор'), 'сор');
  assert.equal(normalizeForMatch('это сор, да'), 'этосорда');
  assert.equal(compileRules({ ngWords: ['cop'] }).matchWord('это сор'), null);
});

test('キリル文字だけで書いた NG ワードは、ラテン文字の本文に当たらない', () => {
  assert.equal(compileRules({ ngWords: ['сор'] }).matchWord('cop'), null);
});

test('ラテン文字と混ざった語は、記号を挟んでも、日本語の文の中でも置き換える', () => {
  assert.equal(normalizeForMatch('ѕ.р.а.m'), 'spam');
  assert.equal(normalizeForMatch('これはѕраmです'), 'これはspamです');
  // A Russian word beside a mixed word keeps its Cyrillic letters
  assert.equal(normalizeForMatch('сор ѕраm'), 'сорspam');
});

test('ラテン文字を含まない日本語の文の中のギリシャ文字は置き換えない', () => {
  assert.equal(normalizeForMatch('αチーム'), 'αちーむ');
});
