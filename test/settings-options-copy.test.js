import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_CATEGORIES } from '../src/config.js';
import { parseStoredOptions } from '../src/settings.js';

// 既定値の経路でも config.js の AI_CATEGORIES をそのまま渡さない。受け取った側が書き換えても既定値が変わらないようにする。

test('aiCategories を書いていないときも、config.js の配列をそのまま渡さず写しを返す', () => {
  const result = parseStoredOptions(() => undefined);
  assert.deepEqual(result.options.aiCategories, AI_CATEGORIES);
  assert.notEqual(result.options.aiCategories, AI_CATEGORIES);
  assert.notEqual(result.options.aiCategories[0], AI_CATEGORIES[0]);
});

test('aiCategories が不正で既定値に戻すときも、config.js の配列をそのまま渡さず写しを返す', () => {
  const result = parseStoredOptions((key) => (key === 'aiCategories' ? [] : undefined));
  assert.deepEqual(result.options.aiCategories, AI_CATEGORIES);
  assert.notEqual(result.options.aiCategories, AI_CATEGORIES);
});
