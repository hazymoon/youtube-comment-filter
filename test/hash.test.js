import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString } from '../src/hash.js';

test('同じ入力には同じ 8 桁の 16 進を返す', () => {
  assert.equal(hashString('こんにちは'), hashString('こんにちは'));
  assert.match(hashString('こんにちは'), /^[0-9a-f]{8}$/);
});

test('FNV-1a 32bit の既知の値と一致する', () => {
  assert.equal(hashString(''), '811c9dc5');
  assert.equal(hashString('a'), 'e40c292c');
  assert.equal(hashString('foobar'), 'bf9cf968');
});

test('異なる入力には異なる値を返す', () => {
  const values = new Set(['a', 'b', 'ab', 'ba', 'こんにちは', 'こんにちわ', '😀'].map(hashString));
  assert.equal(values.size, 7);
});
