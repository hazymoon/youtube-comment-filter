import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredSettings } from '../src/settings.js';

// NG ユーザ・NG ワードを Violentmonkey の「値」タブにも書けるようにする。
// スクリプト本体の定数は dist を貼り替えると空に戻るが、値は残るため。

test('文字列の配列をそのまま使い、"/…/flags" の形の文字列は正規表現にする', () => {
  const result = parseStoredSettings({
    ngUsers: ['@foo', 'UCxxxxxxxxxxxxxxxxxxxxxx'],
    ngWords: ['ネタバレ', '/死ね|しね/i'],
  });
  assert.deepEqual(result.ngUsers, ['@foo', 'UCxxxxxxxxxxxxxxxxxxxxxx']);
  assert.equal(result.ngWords[0], 'ネタバレ');
  assert.ok(result.ngWords[1] instanceof RegExp);
  assert.equal(result.ngWords[1].source, '死ね|しね');
  assert.equal(result.ngWords[1].flags, 'i');
  assert.deepEqual(result.warnings, []);
});

test('値が無ければ空にする', () => {
  assert.deepEqual(parseStoredSettings({ ngUsers: undefined, ngWords: undefined }), {
    ngUsers: [],
    ngWords: [],
    allowUsers: [],
    warnings: [],
  });
});

test('配列でない値と文字列でない要素は捨てて警告する', () => {
  const result = parseStoredSettings({ ngUsers: '@foo', ngWords: ['ok', 3] });
  assert.deepEqual(result.ngUsers, []);
  assert.deepEqual(result.ngWords, ['ok']);
  assert.equal(result.warnings.length, 2);
});

test('正規表現として解釈できない文字列は捨てて警告する', () => {
  const result = parseStoredSettings({ ngUsers: [], ngWords: ['/(/'] });
  assert.deepEqual(result.ngWords, []);
  assert.equal(result.warnings.length, 1);
});

test('前後の / だけの文字列や / を含む普通の語は文字列のまま扱う', () => {
  const result = parseStoredSettings({ ngUsers: [], ngWords: ['//', 'a/b'] });
  assert.deepEqual(result.ngWords, ['//', 'a/b']);
});
