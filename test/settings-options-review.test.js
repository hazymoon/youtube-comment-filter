import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_CATEGORIES } from '../src/config.js';
import { parseStoredOptions } from '../src/settings.js';

// parseStoredOptions のレビューで見つかった不具合の再発を防ぐ。

/**
 * 1 つのキーだけを書いたときの結果。
 * @param {string} key 値の名前
 * @param {unknown} value 値
 */
function parseOne(key, value) {
  return parseStoredOptions((k) => (k === key ? value : undefined));
}

test('aiCategories の name が重複していたら既定値に戻して警告する（AI の応答の enum に同じ値を入れないため）', () => {
  const result = parseOne('aiCategories', [
    { name: '宣伝', description: '商品の宣伝。' },
    { name: '宣伝', description: 'チャンネルの宣伝。' },
  ]);
  assert.deepEqual(result.options.aiCategories, AI_CATEGORIES);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /aiCategories/);
});
