import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheVersion, promptVersion } from '../src/ai.js';

// AI_BATCH_SIZE を変えると判定の仕方が変わる（まとめた判定は他のコメントの影響を受ける）。
// 保存済みの判定を使い続けると方式を比べられず、前の方式の誤判定も残るので、件数もバージョンに含める。

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

test('cacheVersion は AI_BATCH_SIZE が変わると変わる', () => {
  assert.notEqual(cacheVersion(CATEGORIES, 1), cacheVersion(CATEGORIES, 5));
});

test('cacheVersion はカテゴリが変わると変わり、同じ入力なら同じ値を返す', () => {
  assert.equal(cacheVersion(CATEGORIES, 1), cacheVersion(CATEGORIES, 1));
  assert.notEqual(cacheVersion(CATEGORIES, 1), cacheVersion([{ name: '煽り', description: '挑発' }], 1));
  assert.ok(cacheVersion(CATEGORIES, 1).startsWith(promptVersion(CATEGORIES)));
});
