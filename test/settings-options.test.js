import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BATCH_SIZE,
  AI_CACHE_MAX_ENTRIES,
  AI_CATEGORIES,
  AI_ENABLED,
  AI_MAX_CHARS,
  AI_TIMEOUT_MS,
  DEBUG,
  DETECT_IMPERSONATION,
  EXEMPT_OWNER,
  EXEMPT_PINNED,
  EXEMPT_VERIFIED,
  PREVIEW_CHARS,
  REVEAL_DELAY_MS,
  REVEAL_MS_PER_LINE,
} from '../src/config.js';
import { parseStoredOptions } from '../src/settings.js';

// 設定ブロックの値は自動更新でスクリプトごと置き換わると消えるので、「値」タブの個別の値で上書きできるようにする。
// 値が無ければ config.js の既定値を使い、不正な値は既定値に戻して警告する。

const DEFAULTS = {
  aiEnabled: AI_ENABLED,
  aiCategories: AI_CATEGORIES,
  aiBatchSize: AI_BATCH_SIZE,
  aiTimeoutMs: AI_TIMEOUT_MS,
  aiMaxChars: AI_MAX_CHARS,
  aiCacheMaxEntries: AI_CACHE_MAX_ENTRIES,
  previewChars: PREVIEW_CHARS,
  revealDelayMs: REVEAL_DELAY_MS,
  revealMsPerLine: REVEAL_MS_PER_LINE,
  exemptOwner: EXEMPT_OWNER,
  exemptPinned: EXEMPT_PINNED,
  exemptVerified: EXEMPT_VERIFIED,
  debug: DEBUG,
  detectImpersonation: DETECT_IMPERSONATION,
};

/**
 * キー → 値の表から read 関数を作る。
 * @param {Record<string, unknown>} values 値
 */
function readerOf(values) {
  return (key) => values[key];
}

/**
 * 1 つのキーだけを書いたときの結果。
 * @param {string} key 値の名前
 * @param {unknown} value 値
 */
function parseOne(key, value) {
  return parseStoredOptions(readerOf({ [key]: value }));
}

test('値が無ければ（undefined / null）すべて config.js の既定値を使い、警告しない', () => {
  assert.deepEqual(parseStoredOptions(readerOf({})), { options: DEFAULTS, warnings: [] });
  const allNull = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, null]));
  assert.deepEqual(parseStoredOptions(readerOf(allNull)), { options: DEFAULTS, warnings: [] });
});

test('読むのは対象の 14 個の値の名前だけ', () => {
  const keys = [];
  parseStoredOptions((key) => {
    keys.push(key);
    return undefined;
  });
  assert.deepEqual(keys.toSorted(), Object.keys(DEFAULTS).toSorted());
});

test('正しい値はそのまま使う', () => {
  const categories = [{ name: '宣伝', description: '商品やチャンネルの宣伝。' }];
  const values = {
    aiEnabled: false,
    aiCategories: categories,
    aiBatchSize: 4,
    aiTimeoutMs: 15000,
    aiMaxChars: 200,
    aiCacheMaxEntries: 100,
    previewChars: 10,
    revealDelayMs: 0,
    revealMsPerLine: 1,
    exemptOwner: false,
    exemptPinned: false,
    exemptVerified: false,
    debug: true,
    detectImpersonation: false,
  };
  assert.deepEqual(parseStoredOptions(readerOf(values)), { options: values, warnings: [] });
});

test('真偽値の値に真偽値以外を書くと既定値に戻して警告する', () => {
  for (const key of ['aiEnabled', 'exemptOwner', 'exemptPinned', 'exemptVerified', 'debug']) {
    for (const value of ['false', 0, 1, [], {}]) {
      const result = parseOne(key, value);
      assert.equal(result.options[key], DEFAULTS[key], `${key}: ${JSON.stringify(value)}`);
      assert.equal(result.warnings.length, 1, `${key}: ${JSON.stringify(value)}`);
      assert.match(result.warnings[0], new RegExp(key));
    }
  }
});

test('数値の値に整数以外を書くと既定値に戻して警告する', () => {
  const keys = ['aiBatchSize', 'aiTimeoutMs', 'aiMaxChars', 'aiCacheMaxEntries', 'previewChars', 'revealDelayMs'];
  for (const key of [...keys, 'revealMsPerLine']) {
    for (const value of ['10', 1.5, Number.NaN, Number.POSITIVE_INFINITY, true, [10]]) {
      const result = parseOne(key, value);
      assert.equal(result.options[key], DEFAULTS[key], `${key}: ${String(value)}`);
      assert.equal(result.warnings.length, 1, `${key}: ${String(value)}`);
      assert.match(result.warnings[0], new RegExp(key));
    }
  }
});

test('数値の値が下限より小さいと既定値に戻して警告する', () => {
  const tooSmall = {
    aiBatchSize: 0,
    aiTimeoutMs: 0,
    aiMaxChars: 0,
    aiCacheMaxEntries: 0,
    previewChars: 0,
    revealDelayMs: -1,
    revealMsPerLine: 0,
  };
  for (const [key, value] of Object.entries(tooSmall)) {
    const result = parseOne(key, value);
    assert.equal(result.options[key], DEFAULTS[key], key);
    assert.equal(result.warnings.length, 1, key);
    assert.match(result.warnings[0], new RegExp(key));
  }
});

test('数値の値は下限ちょうどなら使う', () => {
  const lowest = {
    aiBatchSize: 1,
    aiTimeoutMs: 1,
    aiMaxChars: 1,
    aiCacheMaxEntries: 1,
    previewChars: 1,
    revealDelayMs: 0,
    revealMsPerLine: 1,
  };
  for (const [key, value] of Object.entries(lowest)) {
    const result = parseOne(key, value);
    assert.equal(result.options[key], value, key);
    assert.deepEqual(result.warnings, [], key);
  }
});

test('aiCategories が空でない配列でなければ既定値に戻して警告する', () => {
  for (const value of [[], 'カテゴリ', { name: '宣伝', description: '' }, 1]) {
    const result = parseOne('aiCategories', value);
    assert.deepEqual(result.options.aiCategories, AI_CATEGORIES, JSON.stringify(value));
    assert.equal(result.warnings.length, 1, JSON.stringify(value));
    assert.match(result.warnings[0], /aiCategories/);
  }
});

test('aiCategories の要素が 1 つでも不正なら、要素を捨てずに全体を既定値に戻して警告する', () => {
  const good = { name: '宣伝', description: '商品やチャンネルの宣伝。' };
  const badElements = [
    'カテゴリ',
    null,
    { name: '', description: '説明' },
    { name: 1, description: '説明' },
    { description: '説明' },
    { name: '宣伝' },
    { name: '宣伝', description: 1 },
  ];
  for (const bad of badElements) {
    const result = parseOne('aiCategories', [good, bad]);
    assert.deepEqual(result.options.aiCategories, AI_CATEGORIES, JSON.stringify(bad));
    assert.equal(result.warnings.length, 1, JSON.stringify(bad));
    assert.match(result.warnings[0], /aiCategories/);
  }
});

test('aiCategories の description は空文字でもよい', () => {
  const categories = [{ name: '宣伝', description: '' }];
  const result = parseOne('aiCategories', categories);
  assert.deepEqual(result.options.aiCategories, categories);
  assert.deepEqual(result.warnings, []);
});

test('aiCategories は name と description だけを写し、読んだ値と別の配列にする', () => {
  const stored = [{ name: '宣伝', description: '説明', extra: true }];
  const result = parseOne('aiCategories', stored);
  assert.deepEqual(result.options.aiCategories, [{ name: '宣伝', description: '説明' }]);
  assert.notEqual(result.options.aiCategories, stored);
});

test('不正な値が複数あれば、それぞれ警告し、正しい値は使う', () => {
  const result = parseStoredOptions(readerOf({ aiEnabled: 'yes', aiBatchSize: 0, previewChars: 12 }));
  assert.equal(result.options.aiEnabled, AI_ENABLED);
  assert.equal(result.options.aiBatchSize, AI_BATCH_SIZE);
  assert.equal(result.options.previewChars, 12);
  assert.equal(result.warnings.length, 2);
});
